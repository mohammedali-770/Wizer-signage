import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';

/**
 * End-to-end smoke test for the health endpoints.
 * Mirrors the production bootstrap (global prefix + validation pipe).
 */
describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health -> 200 { status: "ok" }', async () => {
    const response = await request(app.getHttpServer()).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.service).toBe('wizer-signage-api');
  });

  it('GET /api/health/ready -> 200 { status: "ok" }', async () => {
    const response = await request(app.getHttpServer()).get('/api/health/ready');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });
});
