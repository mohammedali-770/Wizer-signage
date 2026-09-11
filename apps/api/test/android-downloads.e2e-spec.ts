import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

import { AppModule } from '../src/app.module';

describe('Android release downloads (e2e)', () => {
  let app: INestApplication;
  let root: string;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'wizer-downloads-'));
    mkdirSync(join(root, 'android'));

    // `scripts/publish-android-release.sh` writes the SAME manifest to both the
    // atomic latest.json pointer and the immutable per-version file. The
    // per-version copy is the one the catalog re-reads to decide a release is
    // actually installable, so a stub here would make /android-latest 404 and
    // hide whether the route works at all.
    const manifest = {
      schemaVersion: 1,
      packageName: 'com.wizer.signage',
      versionName: '1.2.3',
      versionCode: 123,
      fileName: 'wizer-signage-v1.2.3-123.apk',
      downloadUrl: '/api/downloads/android/wizer-signage-v1.2.3-123.apk',
      sha256: '0'.repeat(64),
      certificateSha256: '1'.repeat(64),
      sizeBytes: 3,
      minSdk: 23,
      publishedAt: '2026-08-09T00:00:00Z',
    };
    writeFileSync(join(root, 'android', 'latest.json'), JSON.stringify(manifest));
    writeFileSync(
      join(root, 'android', 'wizer-signage-v1.2.3-123.json'),
      `${JSON.stringify(manifest)}\n`,
    );
    writeFileSync(join(root, 'android', 'wizer-signage-v1.2.3-123.apk'), Buffer.from([1, 2, 3]));
    writeFileSync(
      join(root, 'android', 'wizer-signage-v1.2.3-123.apk.sha256'),
      `${'0'.repeat(64)}  wizer-signage-v1.2.3-123.apk\n`,
    );

    process.env.APK_DOWNLOAD_DIR = root;
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    delete process.env.APK_DOWNLOAD_DIR;
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('serves the atomic latest.json pointer with the correct content type', async () => {
    const res = await request(app.getHttpServer()).get('/api/downloads/android/latest.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.body).toMatchObject({ packageName: 'com.wizer.signage', versionCode: 123 });
  });

  it('serves only canonical immutable Android release artifacts', async () => {
    const apk = await request(app.getHttpServer()).get(
      '/api/downloads/android/wizer-signage-v1.2.3-123.apk',
    );
    expect(apk.status).toBe(200);
    expect(apk.headers['content-type']).toBe('application/vnd.android.package-archive');
    expect(apk.headers['content-length']).toBe('3');

    const manifest = await request(app.getHttpServer()).get(
      '/api/downloads/android/wizer-signage-v1.2.3-123.json',
    );
    expect(manifest.status).toBe(200);
    expect(manifest.headers['content-type']).toMatch(/^application\/json/);

    const checksum = await request(app.getHttpServer()).get(
      '/api/downloads/android/wizer-signage-v1.2.3-123.apk.sha256',
    );
    expect(checksum.status).toBe(200);
    expect(checksum.headers['content-type']).toMatch(/^text\/plain/);
  });

  it('redirects the short /apk entry point to the current immutable APK, uncacheably', async () => {
    const res = await request(app.getHttpServer()).get('/api/downloads/android-latest');

    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('/api/downloads/android/wizer-signage-v1.2.3-123.apk');
    // A pinned redirect would hold devices on a superseded APK forever, and the
    // whole point of this route is that its target moves with every release.
    expect(res.headers['cache-control']).toBe('no-store');
    // Declared before @Get(':file'); prove routing, not declaration order.
    expect(res.headers['content-type'] ?? '').not.toMatch(/package-archive/);
  });

  it('404s rather than redirecting when latest.json names a version that is not installable', async () => {
    const latestPath = join(root, 'android', 'latest.json');
    const good = readFileSync(latestPath, 'utf8');
    try {
      writeFileSync(
        latestPath,
        JSON.stringify({ ...JSON.parse(good), versionName: '9.9.9', versionCode: 999 }),
      );

      const res = await request(app.getHttpServer()).get('/api/downloads/android-latest');
      expect(res.status).toBe(404);
      expect(res.headers['location']).toBeUndefined();
    } finally {
      writeFileSync(latestPath, good);
    }
  });

  it('rejects traversal and arbitrary files from the mounted directory', async () => {
    writeFileSync(join(root, 'android', 'secret.txt'), 'must never be public');

    const arbitrary = await request(app.getHttpServer()).get('/api/downloads/android/secret.txt');
    expect(arbitrary.status).toBe(404);

    const encodedTraversal = await request(app.getHttpServer()).get(
      '/api/downloads/android/%2e%2e%2fsecret.txt',
    );
    expect([400, 404]).toContain(encodedTraversal.status);
  });
});
