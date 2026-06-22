import { deriveScreenStatus, OFFLINE_MISSED_HEARTBEATS } from './monitoring.constants';

describe('deriveScreenStatus', () => {
  const now = Date.now();
  const fresh = new Date(now - 10_000); // 10s ago
  const stale = new Date(now - 1000 * 60 * 10); // 10 min ago

  it('returns ONLINE for a fresh heartbeat with no issues', () => {
    expect(
      deriveScreenStatus({
        storedStatus: 'ONLINE',
        lastHeartbeatAt: fresh,
        heartbeatIntervalSeconds: 60,
        now,
      }).status,
    ).toBe('ONLINE');
  });

  it('returns OFFLINE when the last heartbeat is older than the threshold', () => {
    const r = deriveScreenStatus({
      storedStatus: 'ONLINE',
      lastHeartbeatAt: stale,
      heartbeatIntervalSeconds: 60,
      now,
    });
    expect(r.status).toBe('OFFLINE');
    // sanity: threshold is interval * missed
    expect(now - stale.getTime()).toBeGreaterThan(60 * OFFLINE_MISSED_HEARTBEATS * 1000);
  });

  it('returns OFFLINE when there is no heartbeat yet', () => {
    expect(
      deriveScreenStatus({
        storedStatus: 'ONLINE',
        lastHeartbeatAt: null,
        heartbeatIntervalSeconds: 60,
        now,
      }).status,
    ).toBe('OFFLINE');
  });

  it('returns WARNING on a fresh heartbeat reporting a player error', () => {
    const r = deriveScreenStatus({
      storedStatus: 'ONLINE',
      lastHeartbeatAt: fresh,
      heartbeatIntervalSeconds: 60,
      playbackState: 'ERROR',
      now,
    });
    expect(r.status).toBe('WARNING');
    expect(r.warningReason).toMatch(/error/i);
  });

  it('returns WARNING for failed/partial sync', () => {
    expect(
      deriveScreenStatus({
        storedStatus: 'ONLINE',
        lastHeartbeatAt: fresh,
        heartbeatIntervalSeconds: 60,
        syncStatus: 'FAILED',
        now,
      }).status,
    ).toBe('WARNING');
    expect(
      deriveScreenStatus({
        storedStatus: 'ONLINE',
        lastHeartbeatAt: fresh,
        heartbeatIntervalSeconds: 60,
        syncStatus: 'PARTIAL',
        now,
      }).status,
    ).toBe('WARNING');
  });

  it('never overrides DISABLED/ARCHIVED/UNPAIRED/PAIRING', () => {
    for (const s of ['DISABLED', 'ARCHIVED', 'UNPAIRED', 'PAIRING']) {
      expect(
        deriveScreenStatus({
          storedStatus: s,
          lastHeartbeatAt: fresh,
          heartbeatIntervalSeconds: 60,
          now,
        }).status,
      ).toBe(s);
    }
  });
});
