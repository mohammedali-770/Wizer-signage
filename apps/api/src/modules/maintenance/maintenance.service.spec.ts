import { Logger } from '@nestjs/common';

import { MaintenanceService } from './maintenance.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PAGE = 1_000;

/**
 * Sweep pagination.
 *
 * The sweeps used to read ONE flat page (`take: 20_000` for screens,
 * `take: 2_000` for companies) and stop. Past that point, screens silently never
 * got an offline alert and companies silently never got a subscription, grace,
 * storage, or content-expiry alert — with nothing in the logs to say so. These
 * tests pin that every row is now visited, and that the runaway backstop is
 * loud rather than silent.
 */
function build({ screens = 0, companies = 0 }: { screens?: number; companies?: number }) {
  const screenRows = Array.from({ length: screens }, (_, i) => ({
    id: `s${String(i).padStart(7, '0')}`,
    companyId: 'c1',
    name: `S${i}`,
    lastHeartbeatAt: null, // never reported => always offline
    heartbeatIntervalSeconds: 60,
  }));
  const companyRows = Array.from({ length: companies }, (_, i) => ({
    id: `c${String(i).padStart(7, '0')}`,
    name: `C${i}`,
    subscription: null,
  }));

  /** Emulates Prisma keyset pagination over a sorted array. */
  const pageOf = (rows: any[], args: any) => {
    const start = args.cursor
      ? rows.findIndex((r) => r.id === args.cursor.id) + (args.skip ?? 0)
      : 0;
    return Promise.resolve(rows.slice(start, start + args.take));
  };

  const prisma: any = {
    screen: { findMany: jest.fn((args: any) => pageOf(screenRows, args)) },
    company: { findMany: jest.fn((args: any) => pageOf(companyRows, args)) },
    content: { count: jest.fn().mockResolvedValue(0) },
  };
  const alerts = {
    raise: jest.fn().mockResolvedValue({ created: true }),
    resolveByKey: jest.fn().mockResolvedValue(0),
    screenKey: (c: string, s: string, t: string) => `${c}:${s}:${t}`,
    companyKey: (c: string, t: string) => `${c}:${t}`,
  };
  const usageLimits = {
    evaluate: jest.fn().mockResolvedValue({ resources: [{ key: 'storageGb', status: 'OK' }] }),
  };

  const service = new MaintenanceService(
    prisma,
    { get: () => ({ days: 90 }) } as any,
    alerts as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    usageLimits as any,
  );
  return { service, prisma, alerts, usageLimits };
}

describe('MaintenanceService sweep pagination', () => {
  it('visits every screen across many pages, not just the first', async () => {
    const t = build({ screens: 4_500 });
    const raised = await (t.service as any).sweepOfflineScreens(new Date());

    // 4,500 rows = 5 pages (4 full + 1 partial).
    expect(t.prisma.screen.findMany).toHaveBeenCalledTimes(5);
    expect(raised).toBe(4_500);
  });

  it('pages by cursor, never by offset', async () => {
    const t = build({ screens: 2_500 });
    await (t.service as any).sweepOfflineScreens(new Date());

    const calls = t.prisma.screen.findMany.mock.calls.map((c: any[]) => c[0]);
    expect(calls[0].cursor).toBeUndefined();
    // Every subsequent page starts after the last id of the previous page.
    expect(calls[1].cursor).toEqual({ id: `s${String(PAGE - 1).padStart(7, '0')}` });
    expect(calls[1].skip).toBe(1);
    expect(calls[2].cursor).toEqual({ id: `s${String(2 * PAGE - 1).padStart(7, '0')}` });
    for (const call of calls) expect(call.orderBy).toEqual({ id: 'asc' });
  });

  it('stops after a single query when the table fits in one page', async () => {
    const t = build({ screens: 10 });
    await (t.service as any).sweepOfflineScreens(new Date());
    expect(t.prisma.screen.findMany).toHaveBeenCalledTimes(1);
  });

  it('handles an empty table without a second query', async () => {
    const t = build({ screens: 0 });
    await expect((t.service as any).sweepOfflineScreens(new Date())).resolves.toBe(0);
    expect(t.prisma.screen.findMany).toHaveBeenCalledTimes(1);
  });

  it('sweeps every company, past the old 2,000 cap', async () => {
    const t = build({ companies: 3_100 });
    await (t.service as any).sweepCompanies(new Date());
    expect(t.prisma.company.findMany).toHaveBeenCalledTimes(4);
    // usageLimits.evaluate runs once per company — proof all were visited,
    // where the old flat `take: 2_000` would have stopped at 2,000.
    expect(t.usageLimits.evaluate).toHaveBeenCalledTimes(3_100);
  });

  it('warns loudly rather than silently truncating at the runaway backstop', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const t = build({ screens: 10 });
    // A page function that always returns a full page can never terminate
    // naturally — exactly the runaway the backstop exists for.
    let n = 0;
    const rows = () => Array.from({ length: PAGE }, () => ({ id: `x${n++}` })) as { id: string }[];

    const out = await (t.service as any).paginate('runaway', async () => rows());

    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).toContain('NOT swept');
    expect(out.length).toBe(500 * PAGE);
    warn.mockRestore();
  });
});
