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
 *  - Replica-safe dedup: PostgreSQL owns the invariant that a screen may have at
 *    most one PENDING REFRESH_MANIFEST command. createMany(skipDuplicates)
 *    therefore collapses races across API replicas instead of relying on an
 *    in-process read-before-write check.
 *  - Debounced in-process: a burst of edits collapses into ONE dispatch (see
 *    REFRESH_DEBOUNCE_MS).
 *  - Tenant-scoped: only ever targets screens in the given company.
 */

/**
 * How long a dispatch waits so that a burst of edits becomes one refresh.
 * Two seconds is far below the ~12s command-poll cycle, so the device sees no
 * meaningful added latency while a local burst avoids repeated fleet scans.
 */
export const REFRESH_DEBOUNCE_MS = Number(process.env.MANIFEST_REFRESH_DEBOUNCE_MS ?? 2_000);

@Injectable()
export class ManifestRefreshService implements OnModuleDestroy {
  private readonly logger = new Logger(ManifestRefreshService.name);
  /** Companies with a dispatch already scheduled in this process. */
  private readonly pending = new Map<string, NodeJS.Timeout>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Schedule a debounced refresh for a company. Returns immediately; the
   * dispatch runs on a timer and never throws (see refreshCompany).
   *
   * The FIRST call in a burst wins the timer and later ones are dropped rather
   * than pushing it out. Trailing-edge debouncing could postpone a refresh
   * indefinitely during a long edit stream.
   */
  scheduleRefresh(companyId: string): void {
    if (this.pending.has(companyId)) return;

    const timer = setTimeout(() => {
      this.pending.delete(companyId);
      void this.refreshCompany(companyId);
    }, REFRESH_DEBOUNCE_MS);
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
   * Returns the number of commands actually inserted (0 if every screen already
   * has a pending refresh, there are no devices, or dispatch fails).
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

      const expiresAt = new Date(Date.now() + COMMAND_TTL_SECONDS * 1000);
      const result = await this.prisma.deviceCommand.createMany({
        data: devices.map((d) => ({
          companyId,
          screenId: d.screenId,
          deviceId: d.id,
          commandType: DeviceCommandType.REFRESH_MANIFEST,
          status: DeviceCommandStatus.PENDING,
          payload: {} as Prisma.InputJsonValue,
          expiresAt,
        })),
        // Backed by the partial unique index created by
        // 20260810100000_pending_manifest_refresh_unique. PostgreSQL evaluates
        // ON CONFLICT DO NOTHING against that index, so this remains safe when
        // multiple API replicas dispatch the same company concurrently.
        skipDuplicates: true,
      });
      this.logger.debug(
        `Dispatched REFRESH_MANIFEST to ${result.count} screen(s) in company ${companyId}.`,
      );
      return result.count;
    } catch (err) {
      this.logger.warn(`REFRESH_MANIFEST dispatch failed for company ${companyId}: ${String(err)}`);
      return 0;
    }
  }
}
