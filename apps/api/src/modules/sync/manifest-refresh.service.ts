import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
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
 *  - Debounced in-process: a burst of edits collapses into ONE dispatch (see
 *    REFRESH_DEBOUNCE_MS).
 *  - Tenant-scoped: only ever targets screens in the given company.
 */
/**
 * How long a dispatch waits so that a burst of edits becomes one refresh.
 *
 * Editing is bursty by nature — reordering a playlist, bulk-tagging content,
 * saving a schedule then immediately fixing it. Each write triggered its own
 * dispatch, and each dispatch reads every device and every pending command in
 * the company. The PENDING dedup already stopped duplicate COMMANDS from being
 * created, but the two SELECTs ran every time regardless.
 *
 * Two seconds is far below the ~12s command-poll cycle, so the device sees no
 * added latency; it only removes work the device would never have observed.
 */
export const REFRESH_DEBOUNCE_MS = Number(process.env.MANIFEST_REFRESH_DEBOUNCE_MS ?? 2_000);

@Injectable()
export class ManifestRefreshService implements OnModuleDestroy {
  private readonly logger = new Logger(ManifestRefreshService.name);
  /** Companies with a dispatch already scheduled. */
  private readonly pending = new Map<string, NodeJS.Timeout>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Schedule a debounced refresh for a company. Returns immediately; the
   * dispatch runs on a timer and never throws (see refreshCompany).
   *
   * The FIRST call in a burst wins the timer and later ones are dropped rather
   * than pushing it out. Trailing-edge debouncing would let a long stream of
   * edits postpone the refresh indefinitely, which is the opposite of what an
   * operator watching a screen wants.
   */
  scheduleRefresh(companyId: string): void {
    if (this.pending.has(companyId)) return;

    const timer = setTimeout(() => {
      this.pending.delete(companyId);
      void this.refreshCompany(companyId);
    }, REFRESH_DEBOUNCE_MS);
    // Never hold the process open for a pending refresh.
    timer.unref?.();
    this.pending.set(companyId, timer);
  }

  /** Cancel every scheduled dispatch so a shutdown does not leak timers. */
  onModuleDestroy(): void {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }

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
