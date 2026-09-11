import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AndroidReleaseCatalogService } from './android-release-catalog.service';

const SHA = 'a'.repeat(64);
const CERT = 'b'.repeat(64);

/** Writes the latest.json pointer naming a given release. */
function writeLatest(android: string, versionName: string, versionCode: number) {
  const fileName = `wizer-signage-v${versionName}-${versionCode}.apk`;
  writeFileSync(
    join(android, 'latest.json'),
    JSON.stringify({
      schemaVersion: 1,
      packageName: 'com.wizer.signage',
      versionName,
      versionCode,
      fileName,
      downloadUrl: `/api/downloads/android/${fileName}`,
      sha256: SHA,
      certificateSha256: CERT,
      sizeBytes: 18,
      minSdk: 21,
      publishedAt: '2026-08-09T09:00:00.000Z',
    }),
  );
}

function publishFixture(root: string) {
  const android = join(root, 'android');
  mkdirSync(android, { recursive: true });
  const versionName = '1.4.2';
  const versionCode = 42;
  const fileName = `wizer-signage-v${versionName}-${versionCode}.apk`;
  const apk = Buffer.from('signed-apk-fixture');
  writeFileSync(join(android, fileName), apk);
  writeFileSync(join(android, `${fileName}.sha256`), `${SHA}  ${fileName}\n`);
  writeFileSync(
    join(android, `wizer-signage-v${versionName}-${versionCode}.json`),
    JSON.stringify({
      schemaVersion: 1,
      packageName: 'com.wizer.signage',
      versionName,
      versionCode,
      fileName,
      downloadUrl: `/api/downloads/android/${fileName}`,
      sha256: SHA,
      certificateSha256: CERT,
      sizeBytes: apk.length,
      minSdk: 21,
      publishedAt: '2026-08-09T09:00:00.000Z',
    }),
  );
  return { android, fileName, versionName, versionCode };
}

describe('AndroidReleaseCatalogService', () => {
  const originalDir = process.env.APK_DOWNLOAD_DIR;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'wizer-android-catalog-'));
    process.env.APK_DOWNLOAD_DIR = root;
  });

  afterEach(() => {
    if (originalDir === undefined) delete process.env.APK_DOWNLOAD_DIR;
    else process.env.APK_DOWNLOAD_DIR = originalDir;
    rmSync(root, { recursive: true, force: true });
  });

  it('accepts a complete immutable release', () => {
    const release = publishFixture(root);
    expect(
      new AndroidReleaseCatalogService().find(release.versionName, release.versionCode),
    ).toEqual({
      versionName: release.versionName,
      versionCode: release.versionCode,
      fileName: release.fileName,
    });
  });

  it('rejects a manifest when its APK is missing', () => {
    const release = publishFixture(root);
    rmSync(join(release.android, release.fileName));
    expect(new AndroidReleaseCatalogService().find('1.4.2', 42)).toBeNull();
  });

  it('rejects an APK whose real size no longer matches its manifest', () => {
    const release = publishFixture(root);
    writeFileSync(join(release.android, release.fileName), 'short');
    expect(new AndroidReleaseCatalogService().find('1.4.2', 42)).toBeNull();
  });

  it('rejects a checksum sidecar that disagrees with the manifest', () => {
    const release = publishFixture(root);
    writeFileSync(
      join(release.android, `${release.fileName}.sha256`),
      `${'c'.repeat(64)}  ${release.fileName}\n`,
    );
    expect(new AndroidReleaseCatalogService().find('1.4.2', 42)).toBeNull();
  });

  describe('findLatest', () => {
    it('resolves the release that latest.json names', () => {
      const release = publishFixture(root);
      writeLatest(release.android, release.versionName, release.versionCode);
      expect(new AndroidReleaseCatalogService().findLatest()).toEqual({
        versionName: release.versionName,
        versionCode: release.versionCode,
        fileName: release.fileName,
      });
    });

    it('returns null when nothing has been published yet', () => {
      mkdirSync(join(root, 'android'), { recursive: true });
      expect(new AndroidReleaseCatalogService().findLatest()).toBeNull();
    });

    // latest.json only decides WHICH version is current. It is not evidence
    // that the version is installable, so the coordinates go through find(),
    // which re-checks the immutable manifest, the APK and the checksum.
    it('refuses a latest.json naming a version whose APK is absent', () => {
      const release = publishFixture(root);
      rmSync(join(release.android, release.fileName));
      writeLatest(release.android, release.versionName, release.versionCode);
      expect(new AndroidReleaseCatalogService().findLatest()).toBeNull();
    });

    it('refuses a latest.json naming a version whose checksum sidecar is absent', () => {
      const release = publishFixture(root);
      rmSync(join(release.android, `${release.fileName}.sha256`));
      writeLatest(release.android, release.versionName, release.versionCode);
      expect(new AndroidReleaseCatalogService().findLatest()).toBeNull();
    });

    // A half-finished publish, or a rolled-back release directory.
    it('refuses a latest.json naming a version that was never published', () => {
      publishFixture(root);
      writeLatest(join(root, 'android'), '9.9.9', 999);
      expect(new AndroidReleaseCatalogService().findLatest()).toBeNull();
    });

    it('refuses a corrupt latest.json rather than throwing', () => {
      const release = publishFixture(root);
      writeFileSync(join(release.android, 'latest.json'), '{ not json');
      expect(() => new AndroidReleaseCatalogService().findLatest()).not.toThrow();
      expect(new AndroidReleaseCatalogService().findLatest()).toBeNull();
    });

    it('refuses a latest.json missing its version coordinates', () => {
      const release = publishFixture(root);
      writeFileSync(join(release.android, 'latest.json'), JSON.stringify({ schemaVersion: 1 }));
      expect(new AndroidReleaseCatalogService().findLatest()).toBeNull();
    });

    // Path traversal via the pointer must not escape the release directory.
    it('refuses a latest.json whose versionName tries to traverse', () => {
      const release = publishFixture(root);
      writeFileSync(
        join(release.android, 'latest.json'),
        JSON.stringify({ versionName: '../../etc/passwd', versionCode: 1 }),
      );
      expect(new AndroidReleaseCatalogService().findLatest()).toBeNull();
    });
  });
});
