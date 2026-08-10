import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { CompanyStatus, DeviceStatus } from '@prisma/client';

import { CryptoService } from '../../common/crypto/crypto.service';
import type { AuthenticatedDevice } from '../../common/types/device.types';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * `lastSeenAt` is an operational hint, not an event log. Device-auth runs on
 * manifest, sync-plan, heartbeat, proof-of-play and command requests, so writing
 * it on every authenticated request turns one healthy TV into many DB writes per
 * minute. Five minutes is comfortably below the fleet-health/offline window but
 * removes the write amplification from normal polling.
 */
const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Authenticates a request with a device token (Phase 6 player). The raw token is
 * accepted via `Authorization: Bearer <token>` or `X-Device-Token`; only its
 * sha256 hash is ever compared against the stored `Device.deviceTokenHash`.
 *
 * On success it attaches a strictly-scoped {@link AuthenticatedDevice} (one
 * screen / one company) to the request — never user/dashboard authority — and
 * periodically stamps `lastSeenAt`. Device routes are marked `@Public()` so the
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
        lastSeenAt: true,
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

    const now = new Date();
    const shouldStampLastSeen =
      !row.lastSeenAt || now.getTime() - row.lastSeenAt.getTime() >= LAST_SEEN_WRITE_INTERVAL_MS;

    if (shouldStampLastSeen) {
      // Best-effort liveness stamp; never block the device request on it. The
      // authentication read above is already mandatory, so using its lastSeenAt
      // value avoids issuing even a no-op UPDATE on normal high-frequency polls.
      this.prisma.device
        .update({ where: { id: device.id }, data: { lastSeenAt: now } })
        .catch(() => undefined);
    }

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
