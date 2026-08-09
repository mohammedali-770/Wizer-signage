import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

type CrashSnapshot = {
  crashedAtMillis?: unknown;
  fingerprint?: unknown;
  crashCount?: unknown;
  appVersion?: unknown;
  reportedAt?: unknown;
};

@Injectable()
export class FleetHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(companyId: string) {
    const screens = await this.prisma.screen.findMany({
      where: { companyId, deletedAt: null },
      select: {
        id: true,
        name: true,
        status: true,
        appVersion: true,
        lastHeartbeatAt: true,
        capabilities: true,
      },
      orderBy: { name: 'asc' },
    });

    const versions = new Map<string, number>();
    const crashes: Array<{
      screenId: string;
      screenName: string;
      screenStatus: string;
      appVersion: string | null;
      lastHeartbeatAt: Date | null;
      crashedAtMillis: number;
      fingerprint: string;
      crashCount: number;
      reportedAt: string | null;
    }> = [];

    for (const screen of screens) {
      const version = screen.appVersion?.trim() || 'unknown';
      versions.set(version, (versions.get(version) ?? 0) + 1);

      const capabilities =
        screen.capabilities && typeof screen.capabilities === 'object' && !Array.isArray(screen.capabilities)
          ? (screen.capabilities as Record<string, unknown>)
          : {};
      const crash = capabilities.deviceCrash as CrashSnapshot | undefined;
      if (!crash) continue;

      const crashedAtMillis =
        typeof crash.crashedAtMillis === 'number' && Number.isFinite(crash.crashedAtMillis)
          ? crash.crashedAtMillis
          : null;
      const fingerprint =
        typeof crash.fingerprint === 'string' && /^[a-f0-9]{24}$/.test(crash.fingerprint)
          ? crash.fingerprint
          : null;
      const crashCount =
        typeof crash.crashCount === 'number' && Number.isInteger(crash.crashCount) && crash.crashCount >= 1
          ? crash.crashCount
          : null;
      if (crashedAtMillis === null || fingerprint === null || crashCount === null) continue;

      crashes.push({
        screenId: screen.id,
        screenName: screen.name,
        screenStatus: screen.status,
        appVersion: screen.appVersion,
        lastHeartbeatAt: screen.lastHeartbeatAt,
        crashedAtMillis,
        fingerprint,
        crashCount,
        reportedAt: typeof crash.reportedAt === 'string' ? crash.reportedAt : null,
      });
    }

    crashes.sort((a, b) => b.crashedAtMillis - a.crashedAtMillis);
    return {
      totalScreens: screens.length,
      versionDistribution: [...versions.entries()]
        .map(([version, count]) => ({ version, count }))
        .sort((a, b) => b.count - a.count || a.version.localeCompare(b.version)),
      recentCrashes: crashes.slice(0, 100),
    };
  }
}
