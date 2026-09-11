import { Controller, Get, Header, NotFoundException, Param, Redirect, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { Public } from '../../common/decorators/public.decorator';
import { AndroidReleaseCatalogService } from './android-release-catalog.service';

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

  constructor(private readonly catalog: AndroidReleaseCatalogService) {}

  /**
   * Stable entry point for the CURRENT release, so an installer never has to
   * type a versioned filename.
   *
   * Android TV devices generally ship no browser, so a person sideloading the
   * player types a URL into a loader app using a D-pad remote. The immutable
   * path `/api/downloads/android/wizer-signage-v0.6.0-1.apk` is unusable that
   * way and changes every release, which would stale every printed instruction.
   * nginx maps `/apk` here so the typed URL is short and permanent.
   *
   * This must NOT live under /api/downloads/android/: that prefix is an nginx
   * `alias` served straight off disk (`location ^~`), so a request there never
   * reaches the API and would be resolved as a filename.
   *
   * 302, not 301: the target changes with every release and a permanently
   * cached redirect would pin devices and browsers to a stale APK.
   *
   * `no-store` for the same reason. A 302 is not heuristically cacheable under
   * RFC 7234, but loader apps and corporate proxies are not reliably compliant,
   * and anything that pins this response pins a device to a superseded APK.
   * The header belongs HERE and not in nginx's `location = /apk`: that block
   * declares no `add_header`, so it inherits all six server-level security
   * headers, and adding one there would silently drop the other five.
   */
  @Get('android-latest')
  @Header('Cache-Control', 'no-store')
  @Redirect(undefined, 302)
  redirectToLatestApk(): { url: string } {
    const release = this.catalog.findLatest();
    if (!release) {
      throw new NotFoundException('No Android release is currently published.');
    }
    return { url: `/api/downloads/android/${release.fileName}` };
  }

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
