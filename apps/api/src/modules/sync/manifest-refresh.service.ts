import { Injectable, Logger } from '@nestjs/common';
import { DeviceCommandStatus, DeviceCommandType, DeviceStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { COMMAND_TTL_SECONDS } from '../monitoring/monitoring.constants';

/**
 * Pushes REFRESH_MANIFEST commands to a company's paired screens so they
 * re-resolve their playback manifest within one command-poll cycle (~12s)
 * instead of waiting for the periodic refresh (~60s). Called after content /
 * playlist / schedule mutations (Req 1: faster updates after changes).
 *
 * Deliberately depends ONLY on PrismaService — not on DeviceCommandService /
 * MonitoringModule — to avoid a circular module dependency
 * (Monitoring → Device → Schedules → Playlists → … ). It writes the same
 * DeviceCommand rows the device already polls via GET /device/commands/pending.
 *
 * PRINCIPLES:
 *  - Best-effort: NEVER throws — a dispatch failure must not break the
 *    originating content/playlist/schedule write.
 *  - Idempotent on the device: a REFRESH_MANIFEST just makes the player re-fetch
 *    the manifest and compare its hash; if nothing changed it is a no-op.
 *  - Deduped server-side: skips screens that already have a queued (PENDING)
 *    refresh, so rapid edits don't pile up commands.
 *  - Tenant-scoped: only ever targets screens in the given company.
 */
@Injectable()
export class ManifestRefreshService {
  private readonly logger = new Logger(ManifestRefreshService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Dispatch REFRESH_MANIFEST to every paired+active screen in `companyId`.
   * Returns the number of commands created (0 if none / on failure).
   *
   * Company-wide (not per-resource targeted) on purpose: a refresh is cheap and
   * idempotent on the device, content/playlist/schedule edits are infrequent
   * admin actions, and broadcasting guarantees no affected screen is missed.
   */
  async refreshCompany(companyId: string): Promise<number> {
    try {
      const devices = await this.prisma.device.findMany({
        where: {
          companyId,
          status: DeviceStatus.ACTIVE,
          screen: { deletedAt: null },
        },
        select: { id: true, screenId: true },
      });
      if (devices.length === 0) return 0;

      const screenIds = devices.map((d) => d.screenId);

      // Best-effort dedup: don't queue a second refresh for a screen that already
      // has one pending and undelivered. (Not transactional — a rare concurrent
      // edit may still create a duplicate, which is harmless: the device refresh
      // is idempotent and the command expires after the TTL.)
      const queued = await this.prisma.deviceCommand.findMany({
        where: {
          companyId,
          screenId: { in: screenIds },
          commandType: DeviceCommandType.REFRESH_MANIFEST,
          status: DeviceCommandStatus.PENDING,
        },
        select: { screenId: true },
      });
      const queuedScreens = new Set(queued.map((q) => q.screenId));
      const targets = devices.filter((d) => !queuedScreens.has(d.screenId));
      if (targets.length === 0) return 0;

      const expiresAt = new Date(Date.now() + COMMAND_TTL_SECONDS * 1000);
      const result = await this.prisma.deviceCommand.createMany({
        data: targets.map((d) => ({
          companyId,
          screenId: d.screenId,
          deviceId: d.id,
          commandType: DeviceCommandType.REFRESH_MANIFEST,
          status: DeviceCommandStatus.PENDING,
          payload: {} as Prisma.InputJsonValue,
          expiresAt,
        })),
      });
      this.logger.debug(
        `Dispatched REFRESH_MANIFEST to ${result.count} screen(s) in company ${companyId}.`,
      );
      return result.count;
    } catch (err) {
      // Best-effort only — log and swallow so the caller's write still succeeds.
      this.logger.warn(`REFRESH_MANIFEST dispatch failed for company ${companyId}: ${String(err)}`);
      return 0;
    }
  }
}
