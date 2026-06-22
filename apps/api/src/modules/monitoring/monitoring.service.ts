import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { ScreenshotService } from './screenshot.service';
import { deriveScreenStatus, type LiveScreenStatus } from './monitoring.constants';

const SCREEN_INCLUDE = {
  device: true,
  location: { select: { id: true, name: true } },
} satisfies Prisma.ScreenInclude;

type ScreenWithDevice = Prisma.ScreenGetPayload<{ include: typeof SCREEN_INCLUDE }>;

/**
 * Read-side monitoring (Phase 8). Live screen status is DERIVED from the last
 * heartbeat on every read (no scheduler needed): a paired screen with no fresh
 * heartbeat is OFFLINE. Provides a fleet overview + per-screen telemetry.
 */
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
      // Capabilities are best-effort: device-reported where available, else placeholder.
      capabilities: {
        screenshot: reportedCaps.screenshot ?? true,
        reboot: reportedCaps.reboot ?? false,
        powerControl: reportedCaps.powerControl ?? false,
        kiosk: reportedCaps.kiosk ?? false,
        autoStart: reportedCaps.autoStart ?? false,
      },
    };
  }

  async overview(companyId: string) {
    const screens = await this.prisma.screen.findMany({
      where: { companyId, deletedAt: null },
      include: SCREEN_INCLUDE,
      orderBy: { name: 'asc' },
    });

    const items = screens.map((s) => {
      const { status, warningReason } = this.statusFor(s);
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

    const byStatus = (st: LiveScreenStatus) => items.filter((i) => i.status === st).length;
    const totals = {
      total: items.length,
      online: byStatus('ONLINE'),
      offline: byStatus('OFFLINE'),
      warning: byStatus('WARNING'),
      unpaired: byStatus('UNPAIRED'),
      pairing: byStatus('PAIRING'),
      disabled: byStatus('DISABLED'),
      archived: byStatus('ARCHIVED'),
    };
    const syncBreakdown = items.reduce<Record<string, number>>((acc, i) => {
      const k = i.syncStatus ?? 'NONE';
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    const withFailedDownloads = items.filter((i) => i.failedDownloads > 0).length;
    const missingHeartbeat = items.filter((i) => i.paired && i.status === 'OFFLINE').length;

    const alerts: {
      severity: 'WARNING' | 'CRITICAL';
      screenId: string;
      name: string;
      message: string;
    }[] = [];
    for (const i of items) {
      if (i.paired && i.status === 'OFFLINE') {
        alerts.push({
          severity: 'CRITICAL',
          screenId: i.id,
          name: i.name,
          message: 'Screen is offline (no recent heartbeat).',
        });
      } else if (i.status === 'WARNING') {
        alerts.push({
          severity: 'WARNING',
          screenId: i.id,
          name: i.name,
          message: i.warningReason ?? 'Warning.',
        });
      }
    }

    return { totals, syncBreakdown, withFailedDownloads, missingHeartbeat, alerts, screens: items };
  }

  private statusFor(screen: ScreenWithDevice): {
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
