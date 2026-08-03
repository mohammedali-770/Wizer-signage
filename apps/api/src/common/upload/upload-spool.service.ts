import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';

import { UPLOAD_TMP_DIR } from './disk-upload';

/** Spooled uploads older than this at boot are orphans from a crashed process. */
const ORPHAN_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * Sweeps orphaned multipart spool files at startup.
 *
 * The upload paths delete their temp file in a `finally`, and multer removes
 * partial files when a request aborts — but neither runs if the process is
 * killed mid-upload (OOM, `docker restart`, a failed deploy). Those `.part`
 * files would otherwise accumulate on disk forever, at up to 300 MB each.
 *
 * Sweeping at boot rather than on a timer is deliberate: the only way to leak a
 * spool file is for the process to die, and the next boot is the first moment
 * anything can observe it. The API container has no scheduler — all recurring
 * work lives in the maintenance container's crontab — so a timer here would be
 * a second, inconsistent scheduling mechanism for no extra coverage.
 */
@Injectable()
export class UploadSpoolService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UploadSpoolService.name);

  async onApplicationBootstrap(): Promise<void> {
    await this.sweep();
  }

  /** Returns the number of orphans removed. Never throws. */
  async sweep(dir: string = UPLOAD_TMP_DIR, now: number = Date.now()): Promise<number> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return 0; // No spool directory yet — nothing has been uploaded.
    }

    let removed = 0;
    for (const name of entries) {
      if (!name.endsWith('.part')) continue;
      const path = join(dir, name);
      try {
        const info = await stat(path);
        // An in-flight upload from a *concurrent* process must survive the sweep.
        if (now - info.mtimeMs < ORPHAN_AGE_MS) continue;
        await unlink(path);
        removed++;
      } catch {
        // Raced with another sweep or with normal cleanup — nothing to do.
      }
    }

    if (removed > 0) {
      this.logger.warn(`Removed ${removed} orphaned upload spool file(s) from ${dir}.`);
    }
    return removed;
  }
}
