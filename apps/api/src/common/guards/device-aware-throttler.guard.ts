import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rate limiting that understands devices.
 *
 * The default tracker is `req.ip`. Every screen at one customer site sits behind
 * a single NAT address, so the whole site shared one budget: at roughly 7
 * requests/min per screen (heartbeat + command poll + manifest), a 100/min
 * allowance ran out at about **14 screens**. Beyond that, screens started
 * getting 429s — they stopped heartbeating, were swept OFFLINE, raised CRITICAL
 * alerts and stopped receiving manifest updates. In other words, screens went
 * dark at the LARGEST customers first, which is exactly backwards.
 *
 * Device-authenticated requests are therefore tracked per DEVICE, so a site with
 * 200 screens gets 200 independent budgets while a single misbehaving player is
 * still contained. Everything else (login, dashboard, anonymous) keeps IP
 * tracking, where sharing a budget across a NAT is the desired behaviour.
 */
@Injectable()
export class DeviceAwareThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    // Set by DeviceAuthGuard once the device token is verified. Using the
    // resolved device id (not the raw token) keeps the token out of the
    // throttler's storage keys.
    const device = req.device as { id?: string } | undefined;
    if (device?.id) return `device:${device.id}`;

    // Fall back to the framework's own IP resolution (honours `trust proxy`).
    return super.getTracker(req);
  }
}
