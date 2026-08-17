import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { AuthenticatedDevice } from '../../common/types/device.types';
import { PrismaService } from '../../prisma/prisma.service';
import type { DeviceCrashReportDto } from './dto/crash-report.dto';

@Injectable()
export class DeviceCrashService {
  constructor(private readonly prisma: PrismaService) {}

  async record(device: AuthenticatedDevice, dto: DeviceCrashReportDto) {
    const screen = await this.prisma.screen.findFirst({
      where: { id: device.screenId, companyId: device.companyId, deletedAt: null },
      select: { id: true, capabilities: true },
    });
    if (!screen) throw new NotFoundException('Screen not found.');

    const current =
      screen.capabilities &&
      typeof screen.capabilities === 'object' &&
      !Array.isArray(screen.capabilities)
        ? (screen.capabilities as Record<string, unknown>)
        : {};

    await this.prisma.screen.update({
      where: { id: screen.id },
      data: {
        capabilities: {
          ...current,
          deviceCrash: {
            crashedAtMillis: dto.crashedAtMillis,
            fingerprint: dto.fingerprint,
            crashCount: dto.crashCount,
            appVersion: dto.appVersion ?? null,
            reportedAt: new Date().toISOString(),
          },
        } as Prisma.InputJsonValue,
        ...(dto.appVersion !== undefined ? { appVersion: dto.appVersion } : {}),
      },
    });

    return { accepted: true };
  }
}
