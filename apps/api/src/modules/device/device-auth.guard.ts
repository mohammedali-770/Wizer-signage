import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { DeviceStatus } from '@prisma/client';

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

    const device = await this.prisma.device.findFirst({
      where: { deviceTokenHash: this.crypto.sha256(token), status: DeviceStatus.ACTIVE },
      select: { id: true, deviceId: true, screenId: true, companyId: true },
    });
    if (!device) throw new UnauthorizedException('Invalid or revoked device token.');

    request.device = device;
    // Best-effort liveness stamp; never block the request on it.
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
