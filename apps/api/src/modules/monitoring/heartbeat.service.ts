import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DeviceCommandStatus, NotificationSeverity, Prisma, ScreenStatus } from '@prisma/client';

import type { AuthenticatedDevice } from '../../common/types/device.types';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertService } from '../notifications/alert.service';
import { AlertEvent } from '../notifications/notifications.constants';
import type { HeartbeatDto } from './dto/monitoring.dto';

/**
 * How often a heartbeat is sampled into the append-only timeline when nothing
 * has changed. State transitions are always recorded.
 */
export const HEARTBEAT_HISTORY_INTERVAL_MS = Number(
  process.env.HEARTBEAT_HISTORY_INTERVAL_MS ?? 5 * 60_000,
);

@Injectable()
export class HeartbeatService {
  private readonly logger = new Logger(HeartbeatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertService,
  ) {}

  async record(device: AuthenticatedDevice, dto: HeartbeatDto) {
    const now = new Date();
    const toBigInt = (v?: number) => (v !== undefined ? BigInt(Math.round(v)) : undefined);

    const txResult = await this.prisma.$transaction(async (tx) => {
      // Read the previous screen/device state INSIDE the same transaction that
      // applies this heartbeat. The old path read first and then opened a
      // separate write transaction, allowing concurrent beats to make the
      // history/status decision from a stale snapshot.
      const screen = await tx.screen.findFirst({
        where: { id: device.screenId, companyId: device.companyId, deletedAt: null },
        select: {
          id: true,
          status: true,
          currentContentId: true,
          currentPlaylistId: true,
          appVersion: true,
          device: {
            select: {
              playbackState: true,
              syncStatus: true,
              lastSyncError: true,
              lastHeartbeatAt: true,
            },
          },
        },
      });
      if (!screen) throw new NotFoundException('Screen not found.');

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
      if (dto.cacheSizeBytes !== undefined)
        deviceData.cacheSizeBytes = toBigInt(dto.cacheSizeBytes);
      if (dto.availableStorageBytes !== undefined)
        deviceData.availableStorageBytes = toBigInt(dto.availableStorageBytes);
      if (dto.requiredAssets !== undefined) deviceData.requiredAssets = dto.requiredAssets;
      if (dto.cachedAssets !== undefined) deviceData.cachedAssets = dto.cachedAssets;
      if (dto.failedDownloads !== undefined) deviceData.failedDownloads = dto.failedDownloads;
      deviceData.lastSyncError = dto.lastError ?? null;

      const previous = screen.device;
      const stateChanged =
        screen.status !== screenStatus ||
        (previous?.playbackState ?? null) !== (dto.playbackState ?? null) ||
        (previous?.syncStatus ?? null) !== (dto.syncStatus ?? null) ||
        (previous?.lastSyncError ?? null) !== (dto.lastError ?? null);
      const sinceLastBeat = previous?.lastHeartbeatAt
        ? now.getTime() - previous.lastHeartbeatAt.getTime()
        : Number.POSITIVE_INFINITY;
      const writeHistory = stateChanged || sinceLastBeat >= HEARTBEAT_HISTORY_INTERVAL_MS;

      await tx.device.update({ where: { id: device.id }, data: deviceData });

      // Screen is a denormalized operator/read model; Device owns the high-rate
      // live snapshot. Do not rewrite Screen once per beat. Keep only values that
      // are useful to ordinary screen-list/detail reads, and write them only when
      // they actually change.
      const screenContentId = dto.currentContentId ?? null;
      const screenPlaylistId = dto.currentPlaylistId ?? null;
      const screenAppVersion = dto.appVersion ?? screen.appVersion;
      const screenSnapshotChanged =
        screen.status !== screenStatus ||
        screen.currentContentId !== screenContentId ||
        screen.currentPlaylistId !== screenPlaylistId ||
        screen.appVersion !== screenAppVersion;

      if (screenSnapshotChanged) {
        await tx.screen.update({
          where: { id: screen.id },
          data: {
            lastHeartbeatAt: now,
            status: screenStatus,
            currentContentId: screenContentId,
            currentPlaylistId: screenPlaylistId,
            ...(dto.appVersion !== undefined ? { appVersion: dto.appVersion } : {}),
          },
        });
      }

      if (writeHistory) {
        await tx.heartbeat.create({
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
        });
      }

      return { screenId: screen.id, screenStatus, hasIssue };
    });

    // Reconcile alerts outside the telemetry write transaction. Notification
    // delivery/provider latency must never hold a DB transaction open.
    await this.reconcileAlerts(
      device,
      txResult.screenId,
      txResult.screenStatus,
      txResult.hasIssue,
      dto,
    ).catch((e) =>
      this.logger.warn(
        `Heartbeat alert reconcile failed for ${txResult.screenId}: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );

    // The player only needs to know whether polling commands is worthwhile.
    // COUNT(*) scans every pending row for the screen; an indexed existence
    // lookup stops at the first match and preserves the existing numeric 0/1 API.
    const pending = await this.prisma.deviceCommand.findFirst({
      where: {
        screenId: device.screenId,
        status: { in: [DeviceCommandStatus.PENDING, DeviceCommandStatus.DELIVERED] },
      },
      select: { id: true },
    });

    return {
      ok: true,
      status: txResult.screenStatus,
      pendingCommands: pending ? 1 : 0,
    };
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
        dedupeKey: `${companyId}:${screenId}:${AlertEvent.ScreenOnline}:${Date.now()}`,
        informational: true,
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
