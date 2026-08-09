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
 */
@Injectable()
export class AndroidReleaseCatalogService {
  private readonly dir = process.env.APK_DOWNLOAD_DIR ?? '/srv/downloads';

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
    const path = join(this.dir, 'android', manifestName);
    if (!existsSync(path)) return null;

    try {
      const stat = statSync(path);
      if (!stat.isFile() || stat.size <= 0 || stat.size > 64 * 1024) return null;
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as AndroidReleaseManifest;
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
      return { versionName, versionCode, fileName };
    } catch {
      return null;
    }
  }
}
