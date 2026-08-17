import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { Public } from '../../common/decorators/public.decorator';

const LEGACY_APK = /^[A-Za-z0-9._-]+\.apk$/;
const ANDROID_RELEASE_FILE =
  /^(?:latest\.json|wizer-signage-v[A-Za-z0-9._-]+-\d+\.(?:apk|json)|wizer-signage-v[A-Za-z0-9._-]+-\d+\.apk\.sha256)$/;

/**
 * Public Android release downloads served from the host-mounted directory
 * (APK_DOWNLOAD_DIR, default /srv/downloads).
 *
 * `scripts/publish-android-release.sh` atomically publishes the machine-readable
 * OTA channel under `<dir>/android/`: latest.json, immutable per-version JSON,
 * checksum, and APK. Keep the route grammar aligned with that publisher; do not
 * expose arbitrary files from the mount.
 */
@ApiExcludeController()
@Public()
// NOT @SkipThrottle(). Each APK response can stream tens of megabytes off a
// single VPS, so nginx and Nest both keep this public surface bounded.
@Controller('downloads')
export class DownloadsController {
  private readonly dir = process.env.APK_DOWNLOAD_DIR ?? '/srv/downloads';

  /** Backwards-compatible root APK route used by older manual-install docs. */
  @Get(':file')
  serveLegacyApk(@Param('file') file: string, @Res() res: Response): void {
    if (!LEGACY_APK.test(file)) throw new NotFoundException('Not found.');
    this.serveFile(join(this.dir, file), file, 'application/vnd.android.package-archive', res);
  }

  /**
   * Immutable Android release artifacts + the atomic latest.json pointer.
   * This is the contract consumed by the OTA client.
   */
  @Get('android/:file')
  serveAndroidRelease(@Param('file') file: string, @Res() res: Response): void {
    if (!ANDROID_RELEASE_FILE.test(file) || file.includes('..')) {
      throw new NotFoundException('Not found.');
    }

    const contentType = file.endsWith('.apk')
      ? 'application/vnd.android.package-archive'
      : file.endsWith('.json')
        ? 'application/json; charset=utf-8'
        : 'text/plain; charset=utf-8';

    this.serveFile(join(this.dir, 'android', file), file, contentType, res);
  }

  private serveFile(path: string, file: string, contentType: string, res: Response): void {
    if (!existsSync(path)) throw new NotFoundException('File not available.');

    const stat = statSync(path);
    if (!stat.isFile()) throw new NotFoundException('File not available.');

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    createReadStream(path).pipe(res);
  }
}
