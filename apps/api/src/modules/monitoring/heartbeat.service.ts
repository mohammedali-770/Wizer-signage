import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DeviceCommandStatus, NotificationSeverity, Prisma, ScreenStatus } from '@prisma/client';

import type { AuthenticatedDevice } from '../../common/types/device.types';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertService } from '../notifications/alert.service';
import { AlertEvent } from '../notifications/notifications.constants';
import type { HeartbeatDto } from './dto/monitoring.dto';

/**
 * Records a device heartbeat (Phase 8): writes a heartbeat-history row, updates
 * the latest telemetry snapshot on Device, and recomputes the screen's live
 * status (ONLINE/WARNING — never overriding DISABLED/ARCHIVED). Heartbeats are
 * NOT written to the activity log (too noisy) and are NOT proof-of-play.
 *
 * Phase 10: a heartbeat reconciles alerts — a clean one resolves the screen's
 * offline/warning alerts (and emits a one-time recovery notification), a
 * problem one raises a deduplicated warning alert. The offline alert itself is
 * raised by the maintenance sweep (no-heartbeat detection), not here.
 */
@Injectable()
export class HeartbeatService {
  private readonly logger = new Logger(HeartbeatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertService,
  ) {}

  async record(device: AuthenticatedDevice, dto: HeartbeatDto) {
    const screen = await this.prisma.screen.findFirst({
      where: { id: device.screenId, companyId: device.companyId, deletedAt: null },
      select: { id: true, status: true, heartbeatIntervalSeconds: true },
    });
    if (!screen) throw new NotFoundException('Screen not found.');

    const now = new Date();
    // A heartbeat is positive proof the device is online — flip PAIRING/UNPAIRED/
    // OFFLINE → ONLINE (or WARNING on a reported issue). Only manually held
    // DISABLED/ARCHIVED screens are left untouched.
    const hasIssue =
      dto.playbackState === 'ERROR' ||
      dto.syncStatus === 'FAILED' ||
      dto.syncStatus === 'PARTIAL' ||
      !!dto.lastError;
    const screenStatus =
      screen.status === ScreenStatus.DISABLED || screen.status === ScreenStatus.ARCHIVED
        ? screen.status
        : hasIssue
          ? ScreenStatus.WARNING
          : ScreenStatus.ONLINE;

    const toBigInt = (v?: number) => (v !== undefined ? BigInt(Math.round(v)) : undefined);

    const deviceData: Prisma.DeviceUpdateInput = { lastHeartbeatAt: now, lastSeenAt: now };
    if (dto.appVersion !== undefined) deviceData.appVersion = dto.appVersion;
    if (dto.deviceModel !== undefined) deviceData.modelName = dto.deviceModel;
    if (dto.osVersion !== undefined) deviceData.osVersion = dto.osVersion;
    if (dto.platform !== undefined) deviceData.platform = dto.platform;
    if (dto.uptimeSeconds !== undefined) deviceData.uptimeSeconds = dto.uptimeSeconds;
    if (dto.playbackState !== undefined) deviceData.playbackState = dto.playbackState;
    if (dto.networkStatus !== undefined) deviceData.networkStatus = dto.networkStatus;
    deviceData.currentContentId = dto.currentContentId ?? null;
    deviceData.currentPlaylistId = dto.currentPlaylistId ?? null;
    deviceData.currentScheduleId = dto.currentScheduleId ?? null;
    if (dto.manifestVersion !== undefined) deviceData.manifestVersion = dto.manifestVersion;
    if (dto.syncStatus !== undefined) deviceData.syncStatus = dto.syncStatus;
    if (dto.cacheSizeBytes !== undefined) deviceData.cacheSizeBytes = toBigInt(dto.cacheSizeBytes);
    if (dto.availableStorageBytes !== undefined)
      deviceData.availableStorageBytes = toBigInt(dto.availableStorageBytes);
    if (dto.requiredAssets !== undefined) deviceData.requiredAssets = dto.requiredAssets;
    if (dto.cachedAssets !== undefined) deviceData.cachedAssets = dto.cachedAssets;
    if (dto.failedDownloads !== undefined) deviceData.failedDownloads = dto.failedDownloads;
    // Persist the reported error to the snapshot so the read-side status derivation
    // sees it (a clean heartbeat clears it). The syncStatus path still flags
    // failed/partial sync independently.
    deviceData.lastSyncError = dto.lastError ?? null;

    await this.prisma.$transaction([
      this.prisma.device.update({ where: { id: device.id }, data: deviceData }),
      this.prisma.screen.update({
        where: { id: screen.id },
        data: {
          lastHeartbeatAt: now,
          status: screenStatus,
          currentContentId: dto.currentContentId ?? null,
          currentPlaylistId: dto.currentPlaylistId ?? null,
          ...(dto.appVersion !== undefined ? { appVersion: dto.appVersion } : {}),
        },
      }),
      this.prisma.heartbeat.create({
        data: {
          screenId: device.screenId,
          companyId: device.companyId,
          deviceId: device.deviceId,
          online: true,
          playbackState: dto.playbackState,
          networkStatus: dto.networkStatus,
          appVersion: dto.appVersion,
          deviceModel: dto.deviceModel,
          osVersion: dto.osVersion,
          uptimeSeconds: dto.uptimeSeconds,
          currentContentId: dto.currentContentId,
          currentPlaylistId: dto.currentPlaylistId,
          currentScheduleId: dto.currentScheduleId,
          manifestVersion: dto.manifestVersion,
          syncStatus: dto.syncStatus,
          cacheSizeBytes: toBigInt(dto.cacheSizeBytes),
          availableStorageBytes: toBigInt(dto.availableStorageBytes),
          lastError: dto.lastError,
          payload: {
            capabilities: (dto.capabilities ?? {}) as Prisma.InputJsonValue,
            requiredAssets: dto.requiredAssets ?? null,
            cachedAssets: dto.cachedAssets ?? null,
            failedDownloads: dto.failedDownloads ?? null,
          } as Prisma.InputJsonValue,
        },
      }),
    ]);

    // Reconcile alerts (best-effort — never break the heartbeat).
    await this.reconcileAlerts(device, screen.id, screenStatus, hasIssue, dto).catch((e) =>
      this.logger.warn(
        `Heartbeat alert reconcile failed for ${screen.id}: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );

    // Tell the device whether to poll for commands now.
    const pendingCommands = await this.prisma.deviceCommand.count({
      where: {
        screenId: device.screenId,
        status: { in: [DeviceCommandStatus.PENDING, DeviceCommandStatus.DELIVERED] },
      },
    });
    return { ok: true, status: screenStatus, pendingCommands };
  }

  private async reconcileAlerts(
    device: AuthenticatedDevice,
    screenId: string,
    screenStatus: ScreenStatus,
    hasIssue: boolean,
    dto: HeartbeatDto,
  ): Promise<void> {
    const companyId = device.companyId;
    const offlineKey = this.alerts.screenKey(companyId, screenId, AlertEvent.ScreenOffline);
    const warningKey = this.alerts.screenKey(companyId, screenId, AlertEvent.ScreenWarning);

    // The device is reporting, so it is not offline. Clear any offline alert; a
    // genuine recovery (an offline alert was actually open) emits a one-time
    // "back online" notification.
    const recovered = await this.alerts.resolveByKey(offlineKey);
    if (recovered > 0 && !hasIssue) {
      await this.alerts.raise({
        companyId,
        screenId,
        deviceId: device.deviceId,
        type: AlertEvent.ScreenOnline,
        severity: NotificationSeverity.INFO,
        title: 'Screen back online',
        message: 'The screen resumed reporting heartbeats.',
        // Unique key per recovery so it is an independent notification, not deduped.
        dedupeKey: `${companyId}:${screenId}:${AlertEvent.ScreenOnline}:${Date.now()}`,
        informational: true, // notify, but don't linger in the OPEN alerts list
      });
    }

    if (screenStatus === ScreenStatus.WARNING && hasIssue) {
      const reason =
        dto.lastError ??
        (dto.syncStatus === 'FAILED' || dto.syncStatus === 'PARTIAL'
          ? `Sync ${dto.syncStatus.toLowerCase()}`
          : null) ??
        (dto.playbackState === 'ERROR' ? 'Playback error' : 'Reported a problem');
      await this.alerts.raise({
        companyId,
        screenId,
        deviceId: device.deviceId,
        type: AlertEvent.ScreenWarning,
        title: 'Screen reported a problem',
        message: reason,
        dedupeKey: warningKey,
        metadata: { playbackState: dto.playbackState, syncStatus: dto.syncStatus },
      });
    } else {
      await this.alerts.resolveByKey(warningKey);
    }
  }
}
