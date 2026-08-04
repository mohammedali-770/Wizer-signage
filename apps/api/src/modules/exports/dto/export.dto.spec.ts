import { BadRequestException, ValidationPipe } from '@nestjs/common';

import { ExportQueryDto, ExportTypeParamDto } from './export.dto';

/**
 * The exports route used to read bare `@Query('from')` strings, which bypasses
 * the global ValidationPipe entirely — `?from=yesterday` reached `new Date(...)`,
 * became an Invalid Date, and surfaced as a 500. These tests run the *same*
 * pipe configuration as `main.ts` so they prove the real request path.
 */
describe('export DTO validation', () => {
  // Mirrors main.ts exactly.
  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const query = (value: unknown) =>
    pipe.transform(value, { type: 'query', metatype: ExportQueryDto });
  const param = (value: unknown) =>
    pipe.transform(value, { type: 'param', metatype: ExportTypeParamDto });

  describe('ExportQueryDto', () => {
    it('rejects a non-ISO date instead of producing an Invalid Date', async () => {
      await expect(query({ from: 'yesterday' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a non-ISO upper bound', async () => {
      await expect(query({ to: 'next tuesday' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts ISO-8601 bounds', async () => {
      await expect(
        query({ from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' }),
      ).resolves.toMatchObject({ from: '2026-01-01T00:00:00.000Z' });
    });

    it('rejects an unknown format', async () => {
      await expect(query({ format: 'exe' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('normalises a lowercase format so existing links keep working', async () => {
      await expect(query({ format: 'csv' })).resolves.toMatchObject({ format: 'CSV' });
      await expect(query({ format: 'xlsx' })).resolves.toMatchObject({ format: 'XLSX' });
    });

    it('rejects a screenId that is not a UUID', async () => {
      await expect(query({ screenId: "1' OR 1=1" })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a UUID screenId', async () => {
      const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
      await expect(query({ screenId: id })).resolves.toMatchObject({ screenId: id });
    });

    it('bounds the free-text status filter', async () => {
      await expect(query({ status: 'x'.repeat(65) })).rejects.toBeInstanceOf(BadRequestException);
      await expect(query({ status: 'ONLINE' })).resolves.toMatchObject({ status: 'ONLINE' });
    });

    it('rejects unknown query parameters rather than silently ignoring them', async () => {
      await expect(query({ companyId: 'other-tenant' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('accepts an empty query — every filter is optional', async () => {
      await expect(query({})).resolves.toEqual({});
    });
  });

  describe('ExportTypeParamDto', () => {
    it('rejects an unknown dataset', async () => {
      await expect(param({ type: 'passwords' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a known dataset', async () => {
      await expect(param({ type: 'screens' })).resolves.toMatchObject({ type: 'screens' });
    });
  });
});
