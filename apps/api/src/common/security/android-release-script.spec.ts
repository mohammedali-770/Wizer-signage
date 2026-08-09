import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..', '..', '..', '..', '..');
const script = readFileSync(resolve(root, 'scripts/build-android-release.sh'), 'utf8');
const manifest = readFileSync(
  resolve(root, 'apps/android-tv-player/app/src/main/AndroidManifest.xml'),
  'utf8',
);
const releaseNetwork = readFileSync(
  resolve(root, 'apps/android-tv-player/app/src/main/res/xml/network_security_config.xml'),
  'utf8',
);

describe('Android production release invariants', () => {
  it('requires explicit release version name and code before Gradle is invoked', () => {
    expect(script).toContain('Missing --version-name');
    expect(script).toContain('Missing --version-code');
    expect(script).toContain('-PreleaseVersionName="${REQUESTED_VERSION_NAME}"');
    expect(script).toContain('-PreleaseVersionCode="${REQUESTED_VERSION_CODE}"');
  });

  it('verifies the final APK identity matches the requested immutable release', () => {
    expect(script).toContain('Built versionName');
    expect(script).toContain('does not equal requested');
    expect(script).toContain('Built versionCode');
    expect(script).toContain('EXPECTED_PKG="com.wizer.signage"');
  });

  it('still fails closed on missing signing credentials', () => {
    for (const name of [
      'WIZER_ANDROID_KEYSTORE_PATH',
      'WIZER_ANDROID_KEYSTORE_PASSWORD',
      'WIZER_ANDROID_KEY_ALIAS',
      'WIZER_ANDROID_KEY_PASSWORD',
    ]) {
      expect(script).toContain(name);
    }
    expect(script).toContain('Expected signed APK not found');
    expect(script).toContain('apksigner verify');
  });

  it('does not allow app-private player state to be backed up', () => {
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).toContain('android:fullBackupContent="@xml/backup_rules"');
    expect(manifest).toContain('android:dataExtractionRules="@xml/data_extraction_rules"');
  });

  it('ships release resources with cleartext traffic disabled', () => {
    expect(releaseNetwork).toContain('cleartextTrafficPermitted="false"');
    expect(releaseNetwork).not.toContain('cleartextTrafficPermitted="true"');
    expect(releaseNetwork).not.toContain('localhost');
    expect(releaseNetwork).not.toContain('192.168');
  });
});
