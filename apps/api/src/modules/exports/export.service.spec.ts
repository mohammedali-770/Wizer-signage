import { ForbiddenException } from '@nestjs/common';

import { ExportService } from './export.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const COMPANY = { companyId: 'comp1', isSuperAdmin: false };

function build() {
  const prisma: any = {
    proofOfPlay: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          {
            startedAt: new Date('2026-06-15T10:00:00Z'),
            endedAt: null,
            screen: { name: 'Lobby' },
            screenId: 's1',
            contentId: 'c1',
            sourceType: 'SCHEDULE',
            playbackSource: 'LOCAL_CACHE',
            status: 'COMPLETED',
            durationMs: 9000,
            offlinePlayback: false,
          },
        ]),
    },
    invoice: { findMany: jest.fn().mockResolvedValue([]) },
    company: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return { service: new ExportService(prisma), prisma };
}

describe('ExportService', () => {
  it('builds a company-scoped proof-of-play dataset', async () => {
    const t = build();
    const data = await t.service.dataset(COMPANY, 'proof-of-play', {});
    expect(t.prisma.proofOfPlay.findMany.mock.calls[0][0].where).toMatchObject({
      companyId: 'comp1',
    });
    expect(data.headers[0]).toBe('startedAt');
    expect(data.rows).toHaveLength(1);
  });

  it('renders CSV with a header row', async () => {
    const t = build();
    const data = await t.service.dataset(COMPANY, 'proof-of-play', {});
    const out = await t.service.render(data, 'CSV', 'proof-of-play');
    expect(out.contentType).toContain('text/csv');
    expect((out.body as string).split('\r\n')[0]).toContain('startedAt');
    expect(out.filename).toMatch(/^proof-of-play-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('renders XLSX as a Buffer', async () => {
    const t = build();
    const data = await t.service.dataset(COMPANY, 'proof-of-play', {});
    const out = await t.service.render(data, 'XLSX', 'proof-of-play');
    expect(Buffer.isBuffer(out.body)).toBe(true);
    expect(out.filename.endsWith('.xlsx')).toBe(true);
  });

  it('forbids the companies dataset for non-super-admins (no cross-company data)', async () => {
    const t = build();
    await expect(t.service.dataset(COMPANY, 'companies', {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('invoices export works (financial data is exportable, never deleted)', async () => {
    const t = build();
    const data = await t.service.dataset(COMPANY, 'invoices', {});
    expect(t.prisma.invoice.findMany).toHaveBeenCalled();
    expect(data.title).toBe('Invoices');
  });
});
