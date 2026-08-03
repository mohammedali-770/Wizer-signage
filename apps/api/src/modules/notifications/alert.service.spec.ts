import { AlertService } from './alert.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const ACTOR = { userId: 'u1', companyId: 'comp1', isSuperAdmin: false } as any;

function build() {
  const store = new Map<string, any>();
  let seq = 0;
  const prisma: any = {
    alert: {
      findFirst: jest.fn(({ where }: any) => {
        // loadOwned shape: { id, companyId }
        if (where.id) {
          const row = store.get(where.id);
          const ok = row && (where.companyId === undefined || row.companyId === where.companyId);
          return Promise.resolve(ok ? row : null);
        }
        // dedup shape: { dedupeKey, status: { in } }
        const match = [...store.values()].find(
          (a) => a.dedupeKey === where.dedupeKey && where.status?.in?.includes(a.status),
        );
        return Promise.resolve(match ?? null);
      }),
      create: jest.fn(({ data }: any) => {
        const row = { id: `a${++seq}`, ...data, triggeredAt: new Date(), createdAt: new Date() };
        store.set(row.id, row);
        return Promise.resolve(row);
      }),
      update: jest.fn(({ where, data }: any) => {
        const row = store.get(where.id);
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
      updateMany: jest.fn(({ where, data }: any) => {
        let count = 0;
        for (const a of store.values()) {
          if (a.dedupeKey === where.dedupeKey && where.status.in.includes(a.status)) {
            Object.assign(a, data);
            count++;
          }
        }
        return Promise.resolve({ count });
      }),
      findUnique: jest.fn(({ where }: any) => Promise.resolve(store.get(where.id) ?? null)),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'admin1', email: 'admin@comp.com' }]) },
    $transaction: (ops: Promise<any>[]) => Promise.all(ops),
  };
  const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
  const notifications = { create: jest.fn().mockResolvedValue({ id: 'n1' }) };
  const email = { sendEvent: jest.fn().mockResolvedValue({ ok: true, logId: 'e1' }) };
  const preferences = { isEnabled: jest.fn().mockResolvedValue(true) };
  const service = new AlertService(
    prisma,
    activityLog as any,
    notifications as any,
    email as any,
    preferences as any,
  );
  return { service, prisma, activityLog, notifications, email, preferences, store };
}

describe('AlertService.raise (dedup + dispatch)', () => {
  it('creates a new alert and dispatches a notification + email', async () => {
    const t = build();
    const res = await t.service.raise({
      companyId: 'comp1',
      type: 'screen.offline',
      title: 'Offline',
      screenId: 's1',
    });
    expect(res.created).toBe(true);
    expect(t.prisma.alert.create).toHaveBeenCalledTimes(1);
    expect(t.notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'admin1', type: 'screen.offline' }),
    );
    expect(t.email.sendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'admin@comp.com' }),
    );
  });

  it('deduplicates: a repeat of the same condition updates the existing alert (no new row, no re-notify)', async () => {
    const t = build();
    await t.service.raise({
      companyId: 'comp1',
      type: 'screen.offline',
      title: 'Offline',
      screenId: 's1',
    });
    t.notifications.create.mockClear();
    const res = await t.service.raise({
      companyId: 'comp1',
      type: 'screen.offline',
      title: 'Offline again',
      screenId: 's1',
    });
    expect(res.created).toBe(false);
    expect(t.prisma.alert.create).toHaveBeenCalledTimes(1); // still only one
    expect(t.prisma.alert.update).toHaveBeenCalled(); // refreshed
    expect(t.notifications.create).not.toHaveBeenCalled(); // anti-spam
  });

  it('does not email when the EMAIL preference is off, but still creates a dashboard notification', async () => {
    const t = build();
    t.preferences.isEnabled.mockImplementation((_u: string, channel: string) =>
      Promise.resolve(channel === 'DASHBOARD'),
    );
    await t.service.raise({ companyId: 'comp1', type: 'storage.near_limit', title: 'Storage' });
    expect(t.notifications.create).toHaveBeenCalled();
    expect(t.email.sendEvent).not.toHaveBeenCalled();
  });

  it('resolveByKey resolves matching open alerts (auto-resolution)', async () => {
    const t = build();
    await t.service.raise({
      companyId: 'comp1',
      type: 'screen.offline',
      title: 'Offline',
      screenId: 's1',
    });
    const key = t.service.screenKey('comp1', 's1', 'screen.offline');
    const count = await t.service.resolveByKey(key);
    expect(count).toBe(1);
    expect([...t.store.values()][0].status).toBe('RESOLVED');
  });

  it('system alerts (companyId null) target super admins', async () => {
    const t = build();
    await t.service.raise({ companyId: null, type: 'backup.failed', title: 'Backup failed' });
    expect(t.prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ role: 'SUPER_ADMIN' }) }),
    );
  });
});

describe('AlertService management', () => {
  it('acknowledge transitions OPEN → ACKNOWLEDGED and logs', async () => {
    const t = build();
    const { alertId } = await t.service.raise({
      companyId: 'comp1',
      type: 'sync.failed',
      title: 'Sync',
    });
    await t.service.acknowledge({ companyId: 'comp1', isSuperAdmin: false }, ACTOR, alertId);
    expect(t.store.get(alertId).status).toBe('ACKNOWLEDGED');
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'alert.acknowledged' }),
    );
  });

  it('list is company-scoped for non-super-admins', async () => {
    const t = build();
    await t.service.list({ companyId: 'comp1', isSuperAdmin: false }, {
      page: 1,
      pageSize: 20,
    } as any);
    expect(t.prisma.alert.findMany.mock.calls[0][0].where).toMatchObject({ companyId: 'comp1' });
  });
});

/**
 * Persistent-CRITICAL re-notification.
 *
 * Dedup deliberately keeps a repeated condition quiet so a 5-minute sweep does
 * not spam. The failure mode that created was: a CRITICAL notified exactly once
 * and then stayed silent forever, so a single missed email hid the condition
 * (e.g. "backups have stopped") indefinitely. An unacknowledged CRITICAL must
 * therefore page again on a cadence.
 */
describe('AlertService.raise (persistent CRITICAL re-notification)', () => {
  const DAY = 24 * 60 * 60 * 1000;

  const raiseCritical = (t: ReturnType<typeof build>) =>
    t.service.raise({
      companyId: 'comp1',
      type: 'backup.overdue',
      severity: 'CRITICAL' as any,
      title: 'Backups have stopped',
    });

  it('does not re-notify a CRITICAL seen again immediately (anti-spam holds)', async () => {
    const t = build();
    const { alertId } = await raiseCritical(t);
    expect(t.notifications.create).toHaveBeenCalledTimes(1);

    await raiseCritical(t); // same condition, next sweep
    expect(t.notifications.create).toHaveBeenCalledTimes(1);
    expect(t.store.get(alertId).status).toBe('OPEN');
  });

  it('re-notifies an unacknowledged CRITICAL once the cadence has elapsed', async () => {
    const t = build();
    const { alertId } = await raiseCritical(t);
    expect(t.notifications.create).toHaveBeenCalledTimes(1);

    // Age the last notification past the 24h cadence.
    t.store.get(alertId).lastNotifiedAt = new Date(Date.now() - DAY - 60_000);

    await raiseCritical(t);
    expect(t.notifications.create).toHaveBeenCalledTimes(2);
  });

  it('stamps lastNotifiedAt so the cadence is driven by notification time', async () => {
    const t = build();
    const { alertId } = await raiseCritical(t);
    expect(t.store.get(alertId).lastNotifiedAt).toBeInstanceOf(Date);
  });

  it('stays silent for an ACKNOWLEDGED CRITICAL even after the cadence', async () => {
    const t = build();
    const { alertId } = await raiseCritical(t);
    const row = t.store.get(alertId);
    row.status = 'ACKNOWLEDGED';
    row.acknowledgedAt = new Date();
    row.lastNotifiedAt = new Date(Date.now() - DAY - 60_000);

    await raiseCritical(t);
    // Someone owns it — re-paging would be noise.
    expect(t.notifications.create).toHaveBeenCalledTimes(1);
  });

  it('never re-notifies a non-CRITICAL, however long it persists', async () => {
    const t = build();
    const { alertId } = await t.service.raise({
      companyId: 'comp1',
      type: 'screen.offline',
      severity: 'WARNING' as any,
      title: 'Screen offline',
    });
    expect(t.notifications.create).toHaveBeenCalledTimes(1);

    t.store.get(alertId).lastNotifiedAt = new Date(Date.now() - 30 * DAY);
    await t.service.raise({
      companyId: 'comp1',
      type: 'screen.offline',
      severity: 'WARNING' as any,
      title: 'Screen offline',
    });
    expect(t.notifications.create).toHaveBeenCalledTimes(1);
  });
});
