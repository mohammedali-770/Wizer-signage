import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AndroidReleaseCatalogService } from './android-release-catalog.service';

const SHA = 'a'.repeat(64);
const CERT = 'b'.repeat(64);

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
});
