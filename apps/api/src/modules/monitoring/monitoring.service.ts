import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { resolvePagination } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import type { MonitoringOverviewQueryDto } from './dto/monitoring-query.dto';
import { deriveScreenStatus, type LiveScreenStatus } from './monitoring.constants';
import { ScreenshotService } from './screenshot.service';

const SCREEN_INCLUDE = {
  device: true,
  location: { select: { id: true, name: true } },
} satisfies Prisma.ScreenInclude;

type ScreenWithDevice = Prisma.ScreenGetPayload<{ include: typeof SCREEN_INCLUDE }>;

type StatusScreen = {
  status: string;
  lastHeartbeatAt: Date | null;
  heartbeatIntervalSeconds: number | null;
  device: null | {
    lastHeartbeatAt: Date | null;
    syncStatus: string | null;
    lastSyncError: string | null;
    playbackState: string | null;
  };
};

const OVERVIEW_SELECT = {
  id: true,
  name: true,
  status: true,
  lastHeartbeatAt: true,
  heartbeatIntervalSeconds: true,
  appVersion: true,
  location: { select: { name: true } },
  device: {
    select: {
      status: true,
      lastHeartbeatAt: true,
      playbackState: true,
      currentContentId: true,
      syncStatus: true,
      lastSyncError: true,
      appVersion: true,
      cacheSizeBytes: true,
      failedDownloads: true,
    },
  },
} satisfies Prisma.ScreenSelect;

type FleetAggregate = {
  total: bigint;
  online: bigint;
  offline: bigint;
  warning: bigint;
  unpaired: bigint;
  pairing: bigint;
  disabled: bigint;
  archived: bigint;
  with_failed_downloads: bigint;
  missing_heartbeat: bigint;
};

type AlertRow = {
  id: string;
  name: string;
  live_status: 'OFFLINE' | 'WARNING';
  warning_reason: string | null;
};

@Injectable()
export class MonitoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly screenshots: ScreenshotService,
  ) {}

  async screenMonitoring(companyId: string, screenId: string) {
    const screen = await this.prisma.screen.findFirst({
      where: { id: screenId, companyId, deletedAt: null },
      include: SCREEN_INCLUDE,
    });
    if (!screen) throw new NotFoundException('Screen not found.');
    const device = screen.device;
    const { status, warningReason } = this.statusFor(screen);

    const latestHeartbeat = device
      ? await this.prisma.heartbeat.findFirst({
          where: { screenId, companyId },
          orderBy: { createdAt: 'desc' },
          select: { payload: true, createdAt: true },
        })
      : null;
    const reportedCaps =
      (latestHeartbeat?.payload as { capabilities?: Record<string, boolean> } | null)
        ?.capabilities ?? {};
    const latestScreenshot = await this.screenshots.latest(companyId, screenId);

    return {
      screenId: screen.id,
      name: screen.name,
      status,
      warningReason,
      lastHeartbeatAt: device?.lastHeartbeatAt ?? screen.lastHeartbeatAt,
      heartbeatIntervalSeconds: screen.heartbeatIntervalSeconds,
      paired: !!device && device.status === 'ACTIVE',
      telemetry: device
        ? {
            playbackState: device.playbackState,
            networkStatus: device.networkStatus,
            currentContentId: device.currentContentId,
            currentPlaylistId: device.currentPlaylistId,
            currentScheduleId: device.currentScheduleId,
            manifestVersion: device.manifestVersion,
            uptimeSeconds: device.uptimeSeconds,
            appVersion: device.appVersion,
            deviceModel: device.modelName,
            osVersion: device.osVersion,
            platform: device.platform,
          }
        : null,
      cache: device
        ? {
            syncStatus: device.syncStatus,
            manifestSource: device.manifestSource,
            cacheSizeBytes: device.cacheSizeBytes != null ? device.cacheSizeBytes.toString() : null,
            availableStorageBytes:
              device.availableStorageBytes != null ? device.availableStorageBytes.toString() : null,
            requiredAssets: device.requiredAssets,
            cachedAssets: device.cachedAssets,
            failedDownloads: device.failedDownloads,
            lastSyncAt: device.lastSyncAt,
            lastError: device.lastSyncError,
          }
        : null,
      latestScreenshot,
      capabilities: {
        screenshot: reportedCaps.screenshot ?? true,
        reboot: reportedCaps.reboot ?? false,
        powerControl: reportedCaps.powerControl ?? false,
        kiosk: reportedCaps.kiosk ?? false,
        autoStart: reportedCaps.autoStart ?? false,
      },
    };
  }

  async overview(companyId: string, query: MonitoringOverviewQueryDto = {}) {
    const { skip, take, meta } = resolvePagination(query);

    const [aggregateRows, screens, syncGroups, alertRows] = await Promise.all([
      this.prisma.$queryRaw<FleetAggregate[]>`
        WITH fleet AS (
          SELECT
            s."id",
            CASE
              WHEN s."status"::text IN ('DISABLED', 'ARCHIVED', 'UNPAIRED', 'PAIRING')
                THEN s."status"::text
              WHEN COALESCE(d."lastHeartbeatAt", s."lastHeartbeatAt") IS NULL
                OR COALESCE(d."lastHeartbeatAt", s."lastHeartbeatAt") <
                  CURRENT_TIMESTAMP - make_interval(
                    secs => COALESCE(NULLIF(s."heartbeatIntervalSeconds", 0), 60) * 3
                  )
                THEN 'OFFLINE'
              WHEN d."playbackState"::text = 'ERROR'
                OR d."syncStatus"::text IN ('FAILED', 'PARTIAL')
                OR NULLIF(d."lastSyncError", '') IS NOT NULL
                THEN 'WARNING'
              ELSE 'ONLINE'
            END AS live_status,
            (d."status"::text = 'ACTIVE') AS paired,
            COALESCE(d."failedDownloads", 0) AS failed_downloads
          FROM "screens" s
          LEFT JOIN "devices" d ON d."screenId" = s."id"
          WHERE s."companyId" = ${companyId} AND s."deletedAt" IS NULL
        )
        SELECT
          COUNT(*)::bigint AS total,
          COUNT(*) FILTER (WHERE live_status = 'ONLINE')::bigint AS online,
          COUNT(*) FILTER (WHERE live_status = 'OFFLINE')::bigint AS offline,
          COUNT(*) FILTER (WHERE live_status = 'WARNING')::bigint AS warning,
          COUNT(*) FILTER (WHERE live_status = 'UNPAIRED')::bigint AS unpaired,
          COUNT(*) FILTER (WHERE live_status = 'PAIRING')::bigint AS pairing,
          COUNT(*) FILTER (WHERE live_status = 'DISABLED')::bigint AS disabled,
          COUNT(*) FILTER (WHERE live_status = 'ARCHIVED')::bigint AS archived,
          COUNT(*) FILTER (WHERE failed_downloads > 0)::bigint AS with_failed_downloads,
          COUNT(*) FILTER (WHERE paired AND live_status = 'OFFLINE')::bigint AS missing_heartbeat
        FROM fleet
      `,
      this.prisma.screen.findMany({
        where: { companyId, deletedAt: null },
        select: OVERVIEW_SELECT,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip,
        take,
      }),
      this.prisma.device.groupBy({
        by: ['syncStatus'],
        where: { companyId, screen: { deletedAt: null } },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<AlertRow[]>`
        WITH fleet AS (
          SELECT
            s."id",
            s."name",
            (d."status"::text = 'ACTIVE') AS paired,
            CASE
              WHEN s."status"::text IN ('DISABLED', 'ARCHIVED', 'UNPAIRED', 'PAIRING')
                THEN s."status"::text
              WHEN COALESCE(d."lastHeartbeatAt", s."lastHeartbeatAt") IS NULL
                OR COALESCE(d."lastHeartbeatAt", s."lastHeartbeatAt") <
                  CURRENT_TIMESTAMP - make_interval(
                    secs => COALESCE(NULLIF(s."heartbeatIntervalSeconds", 0), 60) * 3
                  )
                THEN 'OFFLINE'
              WHEN d."playbackState"::text = 'ERROR'
                OR d."syncStatus"::text IN ('FAILED', 'PARTIAL')
                OR NULLIF(d."lastSyncError", '') IS NOT NULL
                THEN 'WARNING'
              ELSE 'ONLINE'
            END AS live_status,
            CASE
              WHEN d."playbackState"::text = 'ERROR' THEN 'Player reported an error.'
              WHEN d."syncStatus"::text = 'FAILED' THEN 'Sync failed.'
              WHEN d."syncStatus"::text = 'PARTIAL' THEN 'Some assets failed to download.'
              WHEN NULLIF(d."lastSyncError", '') IS NOT NULL THEN d."lastSyncError"
              ELSE NULL
            END AS warning_reason
          FROM "screens" s
          LEFT JOIN "devices" d ON d."screenId" = s."id"
          WHERE s."companyId" = ${companyId} AND s."deletedAt" IS NULL
        )
        SELECT id, name, live_status, warning_reason
        FROM fleet
        WHERE (paired AND live_status = 'OFFLINE') OR live_status = 'WARNING'
        ORDER BY CASE WHEN live_status = 'OFFLINE' THEN 0 ELSE 1 END, name ASC, id ASC
        LIMIT 201
      `,
    ]);

    const aggregate = aggregateRows[0] ?? {
      total: 0n,
      online: 0n,
      offline: 0n,
      warning: 0n,
      unpaired: 0n,
      pairing: 0n,
      disabled: 0n,
      archived: 0n,
      with_failed_downloads: 0n,
      missing_heartbeat: 0n,
    };
    const total = Number(aggregate.total);

    const items = screens.map((s) => {
      const { status, warningReason } = this.statusFor(s as StatusScreen);
      const d = s.device;
      return {
        id: s.id,
        name: s.name,
        locationName: s.location?.name ?? null,
        status,
        warningReason,
        lastHeartbeatAt: d?.lastHeartbeatAt ?? s.lastHeartbeatAt,
        playbackState: d?.playbackState ?? null,
        currentContentId: d?.currentContentId ?? null,
        syncStatus: d?.syncStatus ?? null,
        appVersion: d?.appVersion ?? s.appVersion ?? null,
        cacheSizeBytes: d?.cacheSizeBytes != null ? d.cacheSizeBytes.toString() : null,
        failedDownloads: d?.failedDownloads ?? 0,
        paired: !!d && d.status === 'ACTIVE',
      };
    });

    const syncBreakdown: Record<string, number> = {};
    let devicesOnLiveScreens = 0;
    for (const group of syncGroups) {
      const count = group._count._all;
      devicesOnLiveScreens += count;
      syncBreakdown[group.syncStatus ?? 'NONE'] =
        (syncBreakdown[group.syncStatus ?? 'NONE'] ?? 0) + count;
    }
    const noDevice = Math.max(0, total - devicesOnLiveScreens);
    if (noDevice > 0) syncBreakdown.NONE = (syncBreakdown.NONE ?? 0) + noDevice;

    const alertsTruncated = alertRows.length > 200;
    const alerts = alertRows.slice(0, 200).map((row) => ({
      severity: row.live_status === 'OFFLINE' ? ('CRITICAL' as const) : ('WARNING' as const),
      screenId: row.id,
      name: row.name,
      message:
        row.live_status === 'OFFLINE'
          ? 'Screen is offline (no recent heartbeat).'
          : (row.warning_reason ?? 'Warning.'),
    }));

    return {
      totals: {
        total,
        online: Number(aggregate.online),
        offline: Number(aggregate.offline),
        warning: Number(aggregate.warning),
        unpaired: Number(aggregate.unpaired),
        pairing: Number(aggregate.pairing),
        disabled: Number(aggregate.disabled),
        archived: Number(aggregate.archived),
      },
      syncBreakdown,
      withFailedDownloads: Number(aggregate.with_failed_downloads),
      missingHeartbeat: Number(aggregate.missing_heartbeat),
      alerts,
      alertsTruncated,
      screens: items,
      screenMeta: meta(total),
    };
  }

  private statusFor(screen: StatusScreen | ScreenWithDevice): {
    status: LiveScreenStatus;
    warningReason: string | null;
  } {
    const d = screen.device;
    return deriveScreenStatus({
      storedStatus: screen.status,
      lastHeartbeatAt: d?.lastHeartbeatAt ?? screen.lastHeartbeatAt,
      heartbeatIntervalSeconds: screen.heartbeatIntervalSeconds,
      syncStatus: d?.syncStatus,
      lastError: d?.lastSyncError,
      playbackState: d?.playbackState,
    });
  }
}
