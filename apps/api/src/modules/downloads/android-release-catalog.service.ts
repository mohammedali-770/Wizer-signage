import { Injectable } from '@nestjs/common';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const VERSION_NAME_RE = /^(?!.*\.\.)[A-Za-z0-9._-]+$/;
const SHA256_RE = /^[0-9a-fA-F]{64}$/;
const PACKAGE = 'com.wizer.signage';

type AndroidReleaseManifest = {
  schemaVersion?: unknown;
  packageName?: unknown;
  versionName?: unknown;
  versionCode?: unknown;
  fileName?: unknown;
  downloadUrl?: unknown;
  sha256?: unknown;
  certificateSha256?: unknown;
  sizeBytes?: unknown;
  minSdk?: unknown;
  publishedAt?: unknown;
};

export type PublishedAndroidRelease = {
  versionName: string;
  versionCode: number;
  fileName: string;
};

/**
 * Read-only view of the immutable Android release directory shared with nginx.
 * Policy changes and automatic rollback use this rather than trusting an
 * operator-entered version coordinate that may not actually exist on disk.
 *
 * This intentionally verifies the three publication artifacts needed for a
 * recovery — manifest, APK and checksum sidecar — rather than accepting a
 * surviving JSON manifest whose binary was deleted or truncated later.
 */
@Injectable()
export class AndroidReleaseCatalogService {
  private readonly dir = process.env.APK_DOWNLOAD_DIR ?? '/srv/downloads';

  /**
   * Resolve whatever `latest.json` currently points at.
   *
   * latest.json only decides WHICH version is current; it is not trusted to
   * prove that version is installable. The coordinates it names are handed
   * straight to find(), which re-reads the immutable per-version manifest and
   * confirms the APK and its checksum sidecar are both present and consistent.
   * So a latest.json left behind by a half-finished publish, or one whose APK
   * was later deleted or truncated, resolves to null rather than to a download
   * that 404s or serves a partial file.
   */
  findLatest(): PublishedAndroidRelease | null {
    const manifestPath = join(this.dir, 'android', 'latest.json');
    if (!existsSync(manifestPath)) return null;

    try {
      const stat = statSync(manifestPath);
      if (!stat.isFile() || stat.size <= 0 || stat.size > 64 * 1024) return null;

      const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as AndroidReleaseManifest;
      if (typeof parsed.versionName !== 'string' || typeof parsed.versionCode !== 'number') {
        return null;
      }
      return this.find(parsed.versionName, parsed.versionCode);
    } catch {
      return null;
    }
  }

  find(versionName: string, versionCode: number): PublishedAndroidRelease | null {
    if (
      !versionName ||
      versionName.length > 64 ||
      !VERSION_NAME_RE.test(versionName) ||
      !Number.isInteger(versionCode) ||
      versionCode <= 0
    ) {
      return null;
    }

    const manifestName = `wizer-signage-v${versionName}-${versionCode}.json`;
    const androidDir = join(this.dir, 'android');
    const manifestPath = join(androidDir, manifestName);
    if (!existsSync(manifestPath)) return null;

    try {
      const manifestStat = statSync(manifestPath);
      if (!manifestStat.isFile() || manifestStat.size <= 0 || manifestStat.size > 64 * 1024)
        return null;
      const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as AndroidReleaseManifest;
      const fileName = `wizer-signage-v${versionName}-${versionCode}.apk`;
      if (
        parsed.schemaVersion !== 1 ||
        parsed.packageName !== PACKAGE ||
        parsed.versionName !== versionName ||
        parsed.versionCode !== versionCode ||
        parsed.fileName !== fileName ||
        parsed.downloadUrl !== `/api/downloads/android/${fileName}` ||
        typeof parsed.sha256 !== 'string' ||
        !SHA256_RE.test(parsed.sha256) ||
        typeof parsed.certificateSha256 !== 'string' ||
        !SHA256_RE.test(parsed.certificateSha256) ||
        typeof parsed.sizeBytes !== 'number' ||
        !Number.isSafeInteger(parsed.sizeBytes) ||
        parsed.sizeBytes <= 0 ||
        typeof parsed.minSdk !== 'number' ||
        !Number.isInteger(parsed.minSdk) ||
        parsed.minSdk <= 0 ||
        typeof parsed.publishedAt !== 'string' ||
        !Number.isFinite(Date.parse(parsed.publishedAt))
      ) {
        return null;
      }

      const apkPath = join(androidDir, fileName);
      const checksumPath = `${apkPath}.sha256`;
      if (!existsSync(apkPath) || !existsSync(checksumPath)) return null;
      const apkStat = statSync(apkPath);
      const checksumStat = statSync(checksumPath);
      if (!apkStat.isFile() || apkStat.size !== parsed.sizeBytes) return null;
      if (!checksumStat.isFile() || checksumStat.size <= 0 || checksumStat.size > 1024) return null;

      // Publisher writes the standard "<sha>  <filename>" shape. Verify the
      // sidecar binds the exact manifest hash to the exact canonical APK name;
      // the player independently computes the APK SHA-256 before install.
      const checksum = readFileSync(checksumPath, 'utf8').trim();
      const match = checksum.match(/^([0-9a-fA-F]{64})\s+\*?([^/\\\s]+)$/);
      if (!match) return null;
      if (match[1]?.toLowerCase() !== parsed.sha256.toLowerCase() || match[2] !== fileName)
        return null;

      return { versionName, versionCode, fileName };
    } catch {
      return null;
    }
  }
}
