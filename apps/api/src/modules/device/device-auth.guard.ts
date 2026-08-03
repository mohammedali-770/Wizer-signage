import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { CompanyStatus, DeviceStatus } from '@prisma/client';

import { CryptoService } from '../../common/crypto/crypto.service';
import type { AuthenticatedDevice } from '../../common/types/device.types';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Authenticates a request with a device token (Phase 6 player). The raw token is
 * accepted via `Authorization: Bearer <token>` or `X-Device-Token`; only its
 * sha256 hash is ever compared against the stored `Device.deviceTokenHash`.
 *
 * On success it attaches a strictly-scoped {@link AuthenticatedDevice} (one
 * screen / one company) to the request — never user/dashboard authority — and
 * best-effort stamps `lastSeenAt`. Device routes are marked `@Public()` so the
 * global JWT/tenant/2FA guards stand down and this guard governs access.
 */
@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { device?: AuthenticatedDevice }>();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException('Device token required.');

    const row = await this.prisma.device.findFirst({
      where: { deviceTokenHash: this.crypto.sha256(token), status: DeviceStatus.ACTIVE },
      select: {
        id: true,
        deviceId: true,
        screenId: true,
        companyId: true,
        screen: { select: { deletedAt: true } },
        company: { select: { status: true } },
      },
    });
    if (!row) throw new UnauthorizedException('Invalid or revoked device token.');

    // A live token is not enough — what it points AT must still exist.
    //
    // Deleting a screen now revokes its device (screens.service.ts remove()),
    // but tokens issued before that fix are still in the field, and this is the
    // only place that can stop them. Same for a CANCELLED company: the
    // subscription is terminally over, so its devices lose access outright.
    //
    // SUSPENDED is deliberately NOT rejected. Suspension is a recoverable
    // billing state, and the resolver already serves a suspended company an
    // empty manifest with an explanatory warning. Failing authentication
    // instead would put the player into a retry/error loop and drop the screen
    // off the dashboard's fleet view — exactly when an operator needs to see it
    // to resolve the suspension.
    if (row.screen?.deletedAt) {
      throw new UnauthorizedException('Invalid or revoked device token.');
    }
    if (row.company?.status === CompanyStatus.CANCELLED) {
      throw new UnauthorizedException('Invalid or revoked device token.');
    }

    const device = {
      id: row.id,
      deviceId: row.deviceId,
      screenId: row.screenId,
      companyId: row.companyId,
    };
    request.device = device;
    // Best-effort liveness stamp; never block the request on it. Swallowed
    // deliberately and without logging: this fires on every device request in
    // the fleet, so logging a transient failure here would be its own outage.
    this.prisma.device
      .update({ where: { id: device.id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
    return true;
  }

  private extractToken(request: Request): string | null {
    const header = request.headers['x-device-token'];
    if (typeof header === 'string' && header.trim()) return header.trim();
    const auth = request.headers.authorization;
    if (auth?.startsWith('Bearer ')) return auth.slice(7).trim() || null;
    return null;
  }
}
