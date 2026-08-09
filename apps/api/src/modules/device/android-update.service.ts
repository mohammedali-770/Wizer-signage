import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';

import type { AuthenticatedDevice } from '../../common/types/device.types';
import { PrismaService } from '../../prisma/prisma.service';
import type { AndroidUpdateResultDto } from './dto/android-update.dto';

const VERSION_NAME_RE = /^(?!.*\.\.)[A-Za-z0-9._-]+$/;

type OtaSettings = {
  enabled?: boolean;
  rolloutPercent?: number;
  targetVersionName?: string;
  targetVersionCode?: number;
  checkIntervalSeconds?: number;
  screenIds?: unknown;
  groupIds?: unknown;
};

@Injectable()
export class AndroidUpdateService {
  constructor(private readonly prisma: PrismaService) {}

  async getPolicy(device: AuthenticatedDevice) {
    const screen = await this.prisma.screen.findFirst({
      where: { id: device.screenId, companyId: device.companyId, deletedAt: null },
      select: {
        id: true,
        groups: { select: { groupId: true } },
        company: { select: { settings: true } },
      },
    });
    if (!screen) throw new NotFoundException('Screen not found.');

    const companySettings = (screen.company.settings ?? {}) as Record<string, unknown>;
    const raw = (companySettings.androidOta ?? {}) as OtaSettings;
    const rawName = typeof raw.targetVersionName === 'string' ? raw.targetVersionName.trim() : '';
    const targetVersionName =
      rawName.length > 0 && rawName.length <= 64 && VERSION_NAME_RE.test(rawName) ? rawName : null;
    const targetVersionCode =
      Number.isInteger(raw.targetVersionCode) && Number(raw.targetVersionCode) > 0
        ? Number(raw.targetVersionCode)
        : null;
    const rolloutPercent = Math.max(0, Math.min(100, Math.trunc(Number(raw.rolloutPercent) || 0)));
    const checkIntervalSeconds = Math.max(
      900,
      Math.min(86_400, Math.trunc(Number(raw.checkIntervalSeconds) || 21_600)),
    );
    const screenIds = Array.isArray(raw.screenIds)
      ? raw.screenIds.filter((v): v is string => typeof v === 'string')
      : [];
    const groupIds = Array.isArray(raw.groupIds)
      ? raw.groupIds.filter((v): v is string => typeof v === 'string')
      : [];

    // Stable 0..99 cohort. Prefix with companyId so identical screen IDs in
    // different tenants do not share a rollout bucket by construction.
    const digest = createHash('sha256').update(`${device.companyId}:${screen.id}`).digest();
    const cohort = digest.readUInt32BE(0) % 100;
    const explicitCanary =
      screenIds.includes(screen.id) ||
      screen.groups.some((membership) => groupIds.includes(membership.groupId));
    const enabled = raw.enabled === true && targetVersionName !== null && targetVersionCode !== null;
    const eligible = enabled && (explicitCanary || cohort < rolloutPercent);

    return {
      enabled,
      eligible,
      rolloutPercent,
      cohort,
      targetVersionName,
      targetVersionCode,
      checkIntervalSeconds,
    };
  }

  async recordResult(device: AuthenticatedDevice, dto: AndroidUpdateResultDto) {
    const screen = await this.prisma.screen.findFirst({
      where: { id: device.screenId, companyId: device.companyId, deletedAt: null },
      select: { capabilities: true },
    });
    if (!screen) throw new NotFoundException('Screen not found.');
    const capabilities = (screen.capabilities ?? {}) as Record<string, unknown>;
    await this.prisma.screen.update({
      where: { id: device.screenId },
      data: {
        capabilities: {
          ...capabilities,
          androidOta: {
            state: dto.state,
            targetVersionCode: dto.targetVersionCode ?? null,
            installedVersionCode: dto.installedVersionCode ?? null,
            error: dto.error ?? null,
            reportedAt: new Date().toISOString(),
          },
        },
      },
    });
    return { ok: true };
  }
}
