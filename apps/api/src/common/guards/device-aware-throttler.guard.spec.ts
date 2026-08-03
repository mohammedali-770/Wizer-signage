import { DeviceAwareThrottlerGuard } from './device-aware-throttler.guard';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Throttle tracking key.
 *
 * The default tracker is req.ip, so every screen at one customer site — all
 * behind a single NAT address — shared one budget. At ~7 req/min per screen
 * (heartbeat + command poll + manifest) a 100/min allowance ran out at about 14
 * screens: beyond that screens 429'd, stopped heartbeating, were swept OFFLINE,
 * raised CRITICAL alerts and stopped receiving manifest updates. Screens went
 * dark at the biggest customers first.
 */
describe('DeviceAwareThrottlerGuard.getTracker', () => {
  // getTracker is protected; reach it the way the framework does.
  const track = (req: any): Promise<string> => {
    const guard = new DeviceAwareThrottlerGuard({} as any, {} as any, {} as any);
    // Base implementation resolves the IP; stub it so the test is about OUR branch.
    Object.getPrototypeOf(Object.getPrototypeOf(guard)).getTracker = (r: any) =>
      Promise.resolve(`ip:${r.ip}`);
    return (guard as any).getTracker(req);
  };

  it('tracks an authenticated device by its device id', async () => {
    await expect(track({ ip: '203.0.113.7', device: { id: 'dev-1' } })).resolves.toBe(
      'device:dev-1',
    );
  });

  it('gives two screens behind the SAME ip independent budgets', async () => {
    const a = await track({ ip: '203.0.113.7', device: { id: 'dev-1' } });
    const b = await track({ ip: '203.0.113.7', device: { id: 'dev-2' } });
    expect(a).not.toBe(b); // the whole point: one NAT != one budget
  });

  it('falls back to IP tracking for anonymous/dashboard requests', async () => {
    await expect(track({ ip: '203.0.113.7' })).resolves.toBe('ip:203.0.113.7');
  });

  it('falls back to IP when a device object is present but has no id', async () => {
    await expect(track({ ip: '203.0.113.9', device: {} })).resolves.toBe('ip:203.0.113.9');
  });

  it('never puts a device token in the tracking key', async () => {
    const key = await track({
      ip: '203.0.113.7',
      device: { id: 'dev-1', token: 'super-secret-device-token' },
    });
    expect(key).not.toContain('super-secret-device-token');
  });
});
