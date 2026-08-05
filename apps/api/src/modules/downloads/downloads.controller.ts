import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { Public } from '../../common/decorators/public.decorator';

/**
 * Public file downloads served from a host-mounted directory
 * (APK_DOWNLOAD_DIR, default /srv/downloads). Lets an Android TV install the
 * player via the "Downloader" app with a stable URL, e.g.:
 *   https://<domain>/api/downloads/player.apk
 * Drop the .apk into the mounted directory on the host; no rebuild needed.
 */
@ApiExcludeController()
@Public()
// NOT @SkipThrottle(). Each response streams tens of megabytes off a single
// VPS, so an unthrottled loop here saturates the uplink and takes the dashboard
// and every screen's manifest poll down with it. nginx bounds this at the edge
// too (zone=wizer_downloads); this is the half that survives someone hitting
// the container directly.
@Controller('downloads')
export class DownloadsController {
  private readonly dir = process.env.APK_DOWNLOAD_DIR ?? '/srv/downloads';

  @Get(':file')
  serve(@Param('file') file: string, @Res() res: Response): void {
    // Whitelist a safe filename (no path traversal); only .apk is served.
    if (!/^[A-Za-z0-9._-]+\.apk$/.test(file)) {
      throw new NotFoundException('Not found.');
    }
    const path = join(this.dir, file);
    if (!existsSync(path)) {
      throw new NotFoundException('File not available.');
    }
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    res.setHeader('Content-Length', String(statSync(path).size));
    createReadStream(path).pipe(res);
  }
}
