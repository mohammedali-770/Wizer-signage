import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DeviceStatus, PairingStatus, Prisma, ScreenStatus } from '@prisma/client';

import { CryptoService } from '../../common/crypto/crypto.service';
import type { AuthenticatedDevice } from '../../common/types/device.types';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ScheduleResolverService } from '../schedules/schedule-resolver.service';
import {
  AUTO_SCREENSHOT_DEFAULT_ENABLED,
  AUTO_SCREENSHOT_DEFAULT_INTERVAL_MINUTES,
  COMMAND_POLL_INTERVAL_SECONDS,
  HEARTBEAT_INTERVAL_SECONDS,
} from '../monitoring/monitoring.constants';
import type { PairScreenDto, ReportSyncStatusDto, StartPairingDto } from './dto/device.dto';

/** Pairing code lifetime — short by design (single-use, expiring). */
export const PAIRING_CODE_TTL_MINUTES = 10;
/** How often the player should re-fetch its manifest/config. */
export const MANIFEST_REFRESH_SECONDS = 60;
const DEVICE_TOKEN_BYTES = 32;
const PAIRING_SECRET_BYTES = 32;

interface DeviceInfo {
  platform?: string;
  modelName?: string;
  osVersion?: string;
  appVersion?: string;
}

@Injectable()
export class DeviceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly activityLog: ActivityLogService,
    private readonly resolver: ScheduleResolverService,
  ) {}

  // --- Device side -------------------------------------------------------

  /** First-run: mint a single-use pairing code + a private pairing secret. */
  async startPairing(dto: StartPairingDto) {
    const code = await this.generateUniqueCode();
    const pairingSecret = this.crypto.randomToken(PAIRING_SECRET_BYTES);
    const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MINUTES * 60_000);
    const deviceInfo: DeviceInfo = {
      platform: dto.platform,
      modelName: dto.modelName,
      osVersion: dto.osVersion,
      appVersion: dto.appVersion,
    };

    await this.prisma.pairingCode.create({
      data: {
        code,
        deviceId: dto.deviceId,
        pairingSecretHash: this.crypto.sha256(pairingSecret),
        status: PairingStatus.PENDING,
        expiresAt,
        deviceInfo: deviceInfo as Prisma.InputJsonValue,
      },
    });
    // Platform-level (no company yet) — claim is logged once an admin binds it.
    await this.activityLog.log({
      action: 'device.pairing_started',
      category: 'DEVICE',
      companyId: null,
    });
    return { code, expiresAt, pairingSecret, refreshIntervalSeconds: MANIFEST_REFRESH_SECONDS };
  }

  /**
   * Poll pairing status. The private secret (header) is required so that knowing
   * the public code alone never reveals the device token.
   */
  async pairingStatus(code: string, secret: string | undefined) {
    if (!secret) throw new UnauthorizedException('Pairing secret required.');
    const pc = await this.prisma.pairingCode.findUnique({ where: { code } });
    if (
      !pc ||
      !pc.pairingSecretHash ||
      !this.crypto.hashEquals(pc.pairingSecretHash, this.crypto.sha256(secret))
    ) {
      throw new UnauthorizedException('Invalid pairing code or secret.');
    }

    if (pc.status === PairingStatus.PENDING && pc.expiresAt.getTime() < Date.now()) {
      await this.prisma.pairingCode.update({
        where: { id: pc.id },
        data: { status: PairingStatus.EXPIRED },
      });
      return { status: 'expired' as const };
    }
    if (pc.status === PairingStatus.EXPIRED) return { status: 'expired' as const };
    if (pc.status === PairingStatus.REVOKED) return { status: 'revoked' as const };
    if (pc.status === PairingStatus.PENDING) {
      return { status: 'pending' as const, expiresAt: pc.expiresAt };
    }

    // CLAIMED — a dashboard admin bound this code to a screen.
    if (!pc.screenId) return { status: 'pending' as const };
    const device = await this.prisma.device.findUnique({ where: { screenId: pc.screenId } });
    if (!device || device.deviceId !== pc.deviceId || device.status === DeviceStatus.REVOKED) {
      return { status: 'revoked' as const };
    }

    const screen = await this.prisma.screen.findUnique({
      where: { id: pc.screenId },
      select: { name: true, orientation: true },
    });

    // Issue the device token exactly once (the device persists it on receipt).
    if (!device.deviceTokenHash) {
      const token = this.crypto.randomToken(DEVICE_TOKEN_BYTES);
      const now = new Date();
      const info = (pc.deviceInfo ?? {}) as DeviceInfo;
      await this.prisma.$transaction([
        this.prisma.device.update({
          where: { id: device.id },
          data: {
            deviceTokenHash: this.crypto.sha256(token),
            status: DeviceStatus.ACTIVE,
            pairedAt: now,
            platform: info.platform,
            modelName: info.modelName,
            osVersion: info.osVersion,
            appVersion: info.appVersion,
            lastSeenAt: now,
          },
        }),
        this.prisma.screen.update({
          where: { id: pc.screenId },
          data: {
            status: ScreenStatus.ONLINE,
            deviceIdentifier: device.deviceId,
            pairedAt: now,
            appVersion: info.appVersion,
            lastSyncAt: now,
          },
        }),
      ]);
      await this.activityLog.log({
        action: 'device.token_issued',
        category: 'DEVICE',
        companyId: device.companyId,
        targetType: 'screen',
        targetId: pc.screenId,
        metadata: { deviceId: device.deviceId },
      });
      return {
        status: 'paired' as const,
        deviceToken: token,
        screenId: pc.screenId,
        companyId: device.companyId,
        screen: { name: screen?.name ?? null, orientation: screen?.orientation ?? null },
        refreshIntervalSeconds: MANIFEST_REFRESH_SECONDS,
      };
    }

    // Already collected — don't re-issue (lost-token recovery requires re-pairing).
    return {
      status: 'paired' as const,
      screenId: pc.screenId,
      companyId: device.companyId,
      screen: { name: screen?.name ?? null, orientation: screen?.orientation ?? null },
      refreshIntervalSeconds: MANIFEST_REFRESH_SECONDS,
    };
  }

  /** The device's own playback manifest (device-token authenticated). */
  async getManifest(device: AuthenticatedDevice, at?: Date) {
    const manifest = await this.resolver.resolve(
      device.companyId,
      device.screenId,
      at ?? new Date(),
    );
    await this.prisma.screen
      .update({ where: { id: device.screenId }, data: { lastSyncAt: new Date() } })
      .catch(() => undefined);
    return manifest;
  }

  /** Record the device's latest offline-cache / smart-sync status (Phase 7). */
  async recordSyncStatus(device: AuthenticatedDevice, dto: ReportSyncStatusDto) {
    const data: Prisma.DeviceUpdateInput = {
      syncStatus: dto.status,
      lastSyncAt: new Date(),
      lastSeenAt: new Date(),
    };
    if (dto.manifestSource !== undefined) data.manifestSource = dto.manifestSource;
    if (dto.manifestVersion !== undefined) data.manifestVersion = dto.manifestVersion;
    if (dto.requiredAssets !== undefined) data.requiredAssets = dto.requiredAssets;
    if (dto.cachedAssets !== undefined) data.cachedAssets = dto.cachedAssets;
    if (dto.failedDownloads !== undefined) data.failedDownloads = dto.failedDownloads;
    if (dto.cacheSizeBytes !== undefined)
      data.cacheSizeBytes = BigInt(Math.round(dto.cacheSizeBytes));
    if (dto.availableStorageBytes !== undefined) {
      data.availableStorageBytes = BigInt(Math.round(dto.availableStorageBytes));
    }
    if (dto.lastError !== undefined) data.lastSyncError = dto.lastError || null;
    if (dto.failedAssetIds !== undefined) {
      data.syncMetadata = { failedAssetIds: dto.failedAssetIds } as Prisma.InputJsonValue;
    }
    await this.prisma.device.update({ where: { id: device.id }, data });
    return { ok: true };
  }

  /** The device's own configuration (device-token authenticated). */
  async getConfig(device: AuthenticatedDevice) {
    const screen = await this.prisma.screen.findFirst({
      where: { id: device.screenId, companyId: device.companyId, deletedAt: null },
      include: {
        location: { select: { workingHours: true, timezone: true } },
        company: { select: { timezone: true, settings: true } },
      },
    });
    if (!screen) throw new NotFoundException('Screen not found.');
    const companySettings = (screen.company?.settings ?? {}) as Record<string, unknown>;
    const workingHours =
      screen.workingHours ??
      screen.location?.workingHours ??
      companySettings.defaultWorkingHours ??
      null;
    const timezone = screen.location?.timezone ?? screen.company?.timezone ?? 'UTC';

    const autoScreenshot = (companySettings.autoScreenshot ?? {}) as {
      enabled?: boolean;
      intervalMinutes?: number;
    };

    return {
      screenId: screen.id,
      name: screen.name,
      orientation: screen.orientation,
      timezone,
      audio: { enabled: screen.audioEnabled, volume: screen.volume, muted: screen.muted },
      workingHours,
      fallbackContentId: screen.fallbackContentId,
      manifestRefreshIntervalSeconds: MANIFEST_REFRESH_SECONDS,
      // Phase 8 — monitoring cadence + screenshot settings.
      heartbeatIntervalSeconds: screen.heartbeatIntervalSeconds || HEARTBEAT_INTERVAL_SECONDS,
      commandPollIntervalSeconds: COMMAND_POLL_INTERVAL_SECONDS,
      screenshots: {
        automaticEnabled: autoScreenshot.enabled ?? AUTO_SCREENSHOT_DEFAULT_ENABLED,
        automaticIntervalMinutes:
          autoScreenshot.intervalMinutes ?? AUTO_SCREENSHOT_DEFAULT_INTERVAL_MINUTES,
      },
      // Capability/behaviour flags (placeholders refined by device-reported caps).
      kioskDesired: screen.kioskEnabled,
      autoStartDesired: screen.autoStartEnabled,
    };
  }

  // --- Dashboard side ----------------------------------------------------

  /** Bind a pairing code (shown on the TV) to a company screen profile. */
  async pairScreen(
    companyId: string,
    actor: AuthenticatedUser,
    screenId: string,
    dto: PairScreenDto,
  ) {
    await this.assertScreen(companyId, screenId);
    const pc = await this.prisma.pairingCode.findUnique({
      where: { code: dto.pairingCode.trim().toUpperCase() },
    });
    if (!pc || pc.status !== PairingStatus.PENDING) {
      throw new BadRequestException('Invalid or already-used pairing code.');
    }
    if (pc.expiresAt.getTime() < Date.now()) {
      await this.prisma.pairingCode.update({
        where: { id: pc.id },
        data: { status: PairingStatus.EXPIRED },
      });
      throw new BadRequestException('Pairing code has expired. Generate a new one on the screen.');
    }
    const info = (pc.deviceInfo ?? {}) as DeviceInfo;

    await this.prisma.$transaction([
      this.prisma.pairingCode.update({
        where: { id: pc.id },
        data: { status: PairingStatus.CLAIMED, companyId, screenId, claimedAt: new Date() },
      }),
      // One active device per screen — re-pairing replaces (and invalidates) any prior token.
      this.prisma.device.upsert({
        where: { screenId },
        create: {
          companyId,
          screenId,
          deviceId: pc.deviceId ?? 'unknown',
          status: DeviceStatus.PENDING,
          platform: info.platform,
          modelName: info.modelName,
          osVersion: info.osVersion,
          appVersion: info.appVersion,
        },
        update: {
          deviceId: pc.deviceId ?? 'unknown',
          status: DeviceStatus.PENDING,
          deviceTokenHash: null,
          unpairedAt: null,
          platform: info.platform,
          modelName: info.modelName,
          osVersion: info.osVersion,
          appVersion: info.appVersion,
        },
      }),
      this.prisma.screen.update({
        where: { id: screenId },
        data: { status: ScreenStatus.PAIRING },
      }),
    ]);
    await this.log(actor, companyId, 'screen.paired', screenId, { deviceId: pc.deviceId });
    return this.getPairingStatus(companyId, screenId);
  }

  /** Unpair a screen — revokes the device token and resets the screen. */
  async unpairScreen(companyId: string, actor: AuthenticatedUser, screenId: string) {
    await this.assertScreen(companyId, screenId);
    const device = await this.prisma.device.findUnique({ where: { screenId } });
    if (!device || device.status === DeviceStatus.REVOKED) {
      throw new BadRequestException('Screen is not paired.');
    }
    await this.prisma.$transaction([
      this.prisma.device.update({
        where: { screenId },
        data: { status: DeviceStatus.REVOKED, deviceTokenHash: null, unpairedAt: new Date() },
      }),
      this.prisma.screen.update({
        where: { id: screenId },
        data: { status: ScreenStatus.UNPAIRED, deviceIdentifier: null },
      }),
      this.prisma.pairingCode.updateMany({
        where: { screenId, status: { in: [PairingStatus.PENDING, PairingStatus.CLAIMED] } },
        data: { status: PairingStatus.REVOKED },
      }),
    ]);
    await this.log(actor, companyId, 'screen.unpaired', screenId, { deviceId: device.deviceId });
    return this.getPairingStatus(companyId, screenId);
  }

  /** Pairing/device status for the dashboard screen detail page. */
  async getPairingStatus(companyId: string, screenId: string) {
    const screen = await this.assertScreen(companyId, screenId);
    const device = await this.prisma.device.findUnique({ where: { screenId } });
    return {
      screenId,
      screenStatus: screen.status,
      paired: !!device && device.status === DeviceStatus.ACTIVE,
      pendingCollection: !!device && device.status === DeviceStatus.PENDING,
      device:
        device && device.status !== DeviceStatus.REVOKED
          ? {
              deviceId: device.deviceId,
              status: device.status,
              platform: device.platform,
              modelName: device.modelName,
              osVersion: device.osVersion,
              appVersion: device.appVersion,
              pairedAt: device.pairedAt,
              lastSeenAt: device.lastSeenAt,
            }
          : null,
      // Phase 7 — latest sync/cache snapshot (null until the device reports).
      sync:
        device && device.status !== DeviceStatus.REVOKED && device.syncStatus
          ? {
              status: device.syncStatus,
              manifestSource: device.manifestSource,
              manifestVersion: device.manifestVersion,
              requiredAssets: device.requiredAssets,
              cachedAssets: device.cachedAssets,
              failedDownloads: device.failedDownloads,
              cacheSizeBytes:
                device.cacheSizeBytes != null ? device.cacheSizeBytes.toString() : null,
              availableStorageBytes:
                device.availableStorageBytes != null
                  ? device.availableStorageBytes.toString()
                  : null,
              lastSyncAt: device.lastSyncAt,
              lastError: device.lastSyncError,
            }
          : null,
    };
  }

  // --- Helpers -----------------------------------------------------------

  private async assertScreen(companyId: string, screenId: string) {
    const screen = await this.prisma.screen.findFirst({
      where: { id: screenId, companyId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!screen) throw new NotFoundException('Screen not found.');
    return screen;
  }

  private async generateUniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = this.crypto.generatePairingCode();
      const existing = await this.prisma.pairingCode.findUnique({
        where: { code },
        select: { id: true },
      });
      if (!existing) return code;
    }
    throw new BadRequestException('Could not allocate a pairing code. Please retry.');
  }

  private log(
    actor: AuthenticatedUser,
    companyId: string,
    action: string,
    targetId: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    return this.activityLog.log({
      action,
      category: 'DEVICE',
      actorId: actor.userId,
      companyId,
      targetType: 'screen',
      targetId,
      metadata,
    });
  }
}
