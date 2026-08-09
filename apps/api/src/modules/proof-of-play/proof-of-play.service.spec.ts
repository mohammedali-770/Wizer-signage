import { NotFoundException } from '@nestjs/common';

import { ProofOfPlayService } from './proof-of-play.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const DEVICE = { id: 'dev1', deviceId: 'd-abc', screenId: 's1', companyId: 'comp1' };

function build() {
  const store = new Map<string, any>();
  const prisma: any = {
    screen: { findFirst: jest.fn().mockResolvedValue({ id: 's1', locationId: 'loc1' }) },
    proofOfPlay: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(store.get(where.playbackSessionId) ?? null),
      ),
      // The batch pre-read: one query resolving every session id in the batch.
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          (where.playbackSessionId.in as string[])
            .map((id) => store.get(id))
            .filter(Boolean)
            .map((r: any) => ({
              playbackSessionId: r.playbackSessionId,
              status: r.status,
              companyId: r.companyId,
              screenId: r.screenId,
            })),
        ),
      ),
      create: jest.fn(({ data }: any) => {
        store.set(data.playbackSessionId, { ...data });
        return Promise.resolve(data);
      }),
      update: jest.fn(({ where, data }: any) => {
        const row = store.get(where.playbackSessionId);
        Object.assign(
          row,
          Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)),
        );
        return Promise.resolve(row);
      }),
      // Mirrors Postgres: the tenant predicate is part of the statement, so a
      // row owned by another company simply does not match (count 0).
      updateMany: jest.fn(({ where, data }: any) => {
        const row = store.get(where.playbackSessionId);
        if (!row) return Promise.resolve({ count: 0 });
        if (where.companyId !== undefined && row.companyId !== where.companyId)
          return Promise.resolve({ count: 0 });
        if (where.screenId !== undefined && row.screenId !== where.screenId)
          return Promise.resolve({ count: 0 });
        Object.assign(
          row,
          Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)),
        );
        return Promise.resolve({ count: 1 });
      }),
    },
    $transaction: (ops: Promise<any>[]) => Promise.all(ops),
  };
  const service = new ProofOfPlayService(prisma);
  return { service, prisma, store };
}

function event(over: any = {}) {
  return {
    eventType: 'ITEM_STARTED',
    playbackSessionId: 'sess-1',
    startedAt: new Date().toISOString(),
    contentId: 'c1',
    sourceType: 'SCHEDULE',
    playbackSource: 'LOCAL_CACHE',
    contentType: 'IMAGE',
    ...over,
  };
}

describe('ProofOfPlayService.ingest', () => {
  it('creates a STARTED row with tenancy derived from the device token', async () => {
    const t = build();
    const res = await t.service.ingest(DEVICE as any, { events: [event()] });
    expect(res).toEqual({ accepted: 1, rejected: 0 });
    expect(t.prisma.proofOfPlay.create).toHaveBeenCalledTimes(1);
    const data = t.prisma.proofOfPlay.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      companyId: 'comp1',
      screenId: 's1',
      deviceId: 'dev1',
      locationId: 'loc1',
      status: 'STARTED',
    });
  });

  it('ITEM_COMPLETED after STARTED sets COMPLETED + endedAt + duration', async () => {
    const t = build();
    const startedAt = new Date().toISOString();
    await t.service.ingest(DEVICE as any, { events: [event({ startedAt })] });
    await t.service.ingest(DEVICE as any, {
      events: [
        event({
          eventType: 'ITEM_COMPLETED',
          startedAt,
          endedAt: new Date(Date.parse(startedAt) + 9000).toISOString(),
          durationMs: 9000,
        }),
      ],
    });
    const row = t.store.get('sess-1');
    expect(row.status).toBe('COMPLETED');
    expect(row.durationMs).toBe(9000);
    // endedAt - startedAt === durationMs. The player already derives endedAt
    // this way (PlaybackEventTracker.terminal), so a consistent device sees its
    // own value stored unchanged.
    expect(row.endedAt).toEqual(new Date(Date.parse(startedAt) + 9000));
  });

  it('derives endedAt from the duration when the device contradicts itself', async () => {
    // A device reporting endedAt === startedAt alongside durationMs: 9000 is
    // describing an interval that cannot exist. Storing both verbatim leaves a
    // row where a report summing durationMs and a report subtracting the
    // timestamps disagree, with nothing marking which is wrong.
    const t = build();
    const startedAt = new Date().toISOString();
    await t.service.ingest(DEVICE as any, { events: [event({ startedAt })] });
    await t.service.ingest(DEVICE as any, {
      events: [
        event({ eventType: 'ITEM_COMPLETED', startedAt, endedAt: startedAt, durationMs: 9000 }),
      ],
    });
    const row = t.store.get('sess-1');
    expect(row.endedAt.getTime() - Date.parse(startedAt)).toBe(row.durationMs);
  });

  it('does not regress a terminal status back to STARTED (out-of-order/idempotent)', async () => {
    const t = build();
    await t.service.ingest(DEVICE as any, {
      events: [event({ eventType: 'ITEM_COMPLETED', durationMs: 1000 })],
    });
    await t.service.ingest(DEVICE as any, { events: [event({ eventType: 'ITEM_STARTED' })] });
    expect(t.store.get('sess-1').status).toBe('COMPLETED');
  });

  it('ITEM_FAILED records the failure reason', async () => {
    const t = build();
    await t.service.ingest(DEVICE as any, {
      events: [event({ eventType: 'ITEM_FAILED', failureReason: 'decode error' })],
    });
    const row = t.store.get('sess-1');
    expect(row.status).toBe('FAILED');
    expect(row.failureReason).toBe('decode error');
  });

  it('ITEM_SKIPPED records a skipped play', async () => {
    const t = build();
    await t.service.ingest(DEVICE as any, { events: [event({ eventType: 'ITEM_SKIPPED' })] });
    expect(t.store.get('sess-1').status).toBe('SKIPPED');
  });

  it('is idempotent: a re-sent ITEM_STARTED creates only one row', async () => {
    const t = build();
    await t.service.ingest(DEVICE as any, { events: [event()] });
    const res = await t.service.ingest(DEVICE as any, { events: [event()] });
    expect(res.accepted).toBe(1);
    expect(t.prisma.proofOfPlay.create).toHaveBeenCalledTimes(1);
    expect(t.prisma.proofOfPlay.update).not.toHaveBeenCalled();
  });

  it('accepts a buffered offline event within the back-fill window', async () => {
    const t = build();
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const res = await t.service.ingest(DEVICE as any, {
      events: [event({ startedAt: threeDaysAgo, offlinePlayback: true })],
    });
    expect(res.accepted).toBe(1);
    expect(t.store.get('sess-1').offlinePlayback).toBe(true);
  });

  it('rejects an event older than the back-fill window', async () => {
    const t = build();
    const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const res = await t.service.ingest(DEVICE as any, { events: [event({ startedAt: longAgo })] });
    expect(res).toEqual({ accepted: 0, rejected: 1 });
    expect(t.prisma.proofOfPlay.create).not.toHaveBeenCalled();
  });

  it('rejects a future-dated event beyond the tolerated skew', async () => {
    const t = build();
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const res = await t.service.ingest(DEVICE as any, { events: [event({ startedAt: future })] });
    expect(res).toEqual({ accepted: 0, rejected: 1 });
  });

  it('throws 404 when the device screen is missing (defensive)', async () => {
    const t = build();
    t.prisma.screen.findFirst.mockResolvedValue(null);
    await expect(t.service.ingest(DEVICE as any, { events: [event()] })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('ProofOfPlayService reports', () => {
  it('report is company-scoped and paginates', async () => {
    const t = build();
    const row = {
      id: 'p1',
      startedAt: new Date('2026-06-15T10:00:00Z'),
      endedAt: new Date('2026-06-15T10:00:09Z'),
      screenId: 's1',
      screen: { name: 'Lobby', location: { id: 'loc1', name: 'HQ' } },
      locationId: 'loc1',
      contentId: 'c1',
      contentType: 'IMAGE',
      playlistId: 'pl1',
      scheduleId: 'sch1',
      emergencyBroadcastId: null,
      sourceType: 'SCHEDULE',
      playbackSource: 'LOCAL_CACHE',
      status: 'COMPLETED',
      durationMs: 9000,
      expectedDurationMs: 10000,
      offlinePlayback: false,
      failureReason: null,
      manifestVersion: 'v1',
      itemSequence: 0,
      playbackSessionId: 'sess-1',
    };
    t.prisma.proofOfPlay.findMany = jest.fn().mockResolvedValue([row]);
    t.prisma.proofOfPlay.count = jest.fn().mockResolvedValue(1);
    t.prisma.content = { findMany: jest.fn().mockResolvedValue([{ id: 'c1', title: 'Banner' }]) };
    t.prisma.playlist = { findMany: jest.fn().mockResolvedValue([{ id: 'pl1', title: 'Promo' }]) };
    t.prisma.schedule = {
      findMany: jest.fn().mockResolvedValue([{ id: 'sch1', name: 'Daytime' }]),
    };
    t.prisma.emergencyBroadcast = { findMany: jest.fn().mockResolvedValue([]) };

    const out = await t.service.report('comp1', { page: 1, pageSize: 20 } as any);
    expect(t.prisma.proofOfPlay.findMany.mock.calls[0][0].where).toMatchObject({
      companyId: 'comp1',
    });
    expect(out.meta.total).toBe(1);
    expect(out.items[0]).toMatchObject({
      screenName: 'Lobby',
      contentTitle: 'Banner',
      playlistTitle: 'Promo',
      scheduleName: 'Daytime',
      status: 'COMPLETED',
    });
  });

  it('summary aggregates counts, duration and top content', async () => {
    const t = build();
    t.prisma.proofOfPlay.groupBy = jest.fn((args: any) => {
      if (args.by[0] === 'status') {
        return Promise.resolve([
          { status: 'COMPLETED', _count: { _all: 3 } },
          { status: 'FAILED', _count: { _all: 1 } },
        ]);
      }
      if (args.by[0] === 'contentId')
        return Promise.resolve([{ contentId: 'c1', _count: { _all: 3 } }]);
      if (args.by[0] === 'screenId')
        return Promise.resolve([{ screenId: 's1', _count: { _all: 1 } }]);
      return Promise.resolve([]);
    });
    t.prisma.proofOfPlay.aggregate = jest.fn().mockResolvedValue({ _sum: { durationMs: 27000 } });
    t.prisma.content = { findMany: jest.fn().mockResolvedValue([{ id: 'c1', title: 'Banner' }]) };
    t.prisma.screen.findMany = jest.fn().mockResolvedValue([{ id: 's1', name: 'Lobby' }]);

    const out = await t.service.summary('comp1', {} as any);
    expect(out).toMatchObject({
      totalPlays: 4,
      completedPlays: 3,
      failedPlays: 1,
      totalDurationMs: 27000,
    });
    expect(out.mostPlayedContent[0]).toMatchObject({ contentId: 'c1', title: 'Banner', plays: 3 });
    expect(out.screensWithFailures[0]).toMatchObject({
      screenId: 's1',
      name: 'Lobby',
      failures: 1,
    });
  });
});

/**
 * Cross-tenant write protection.
 *
 * `playbackSessionId` is CLIENT-SUPPLIED and globally unique across all tenants,
 * and the terminal update previously ran `update({ where: { playbackSessionId }})`
 * with no tenant predicate. Any device-token holder (a trial signup with one
 * paired screen) could therefore rewrite another company's playback record — the
 * advertiser-billing and compliance trail — by replaying a session id. Session
 * ids are printed in plaintext in every proof-of-play CSV export, so one
 * forwarded report handed an attacker thousands of live write handles.
 */
describe('ProofOfPlayService cross-tenant write protection', () => {
  const OTHER_TENANT_ROW = {
    playbackSessionId: 'sess-victim',
    companyId: 'other-co',
    screenId: 'other-screen',
    status: 'STARTED',
    durationMs: 30_000,
  };

  const terminal = (over: any = {}) =>
    event({
      eventType: 'ITEM_COMPLETED',
      playbackSessionId: 'sess-victim',
      endedAt: new Date().toISOString(),
      durationMs: 1,
      ...over,
    });

  it('refuses to modify a row owned by another company', async () => {
    const t = build();
    t.store.set('sess-victim', { ...OTHER_TENANT_ROW });

    await t.service.ingest(DEVICE as any, { events: [terminal()] } as any);

    const row = t.store.get('sess-victim');
    expect(row.status).toBe('STARTED'); // untouched
    expect(row.durationMs).toBe(30_000); // not zeroed
    expect(row.companyId).toBe('other-co');
  });

  it('refuses to modify another screen within the same company', async () => {
    const t = build();
    t.store.set('sess-victim', {
      ...OTHER_TENANT_ROW,
      companyId: 'comp1', // same tenant...
      screenId: 'a-different-screen', // ...different screen
    });

    await t.service.ingest(DEVICE as any, { events: [terminal()] } as any);
    expect(t.store.get('sess-victim').status).toBe('STARTED');
  });

  it('never issues an update without both companyId and screenId in the predicate', async () => {
    const t = build();
    t.store.set('sess-own', {
      playbackSessionId: 'sess-own',
      companyId: 'comp1',
      screenId: 's1',
      status: 'STARTED',
    });

    await t.service.ingest(
      DEVICE as any,
      { events: [terminal({ playbackSessionId: 'sess-own' })] } as any,
    );

    // The unscoped `update` must not be used at all on this path.
    expect(t.prisma.proofOfPlay.update).not.toHaveBeenCalled();
    for (const call of t.prisma.proofOfPlay.updateMany.mock.calls) {
      expect(call[0].where).toMatchObject({ companyId: 'comp1', screenId: 's1' });
    }
  });

  it('still closes the device its OWN session normally', async () => {
    const t = build();
    t.store.set('sess-own', {
      playbackSessionId: 'sess-own',
      companyId: 'comp1',
      screenId: 's1',
      status: 'STARTED',
    });

    const res = await t.service.ingest(
      DEVICE as any,
      { events: [terminal({ playbackSessionId: 'sess-own' })] } as any,
    );

    expect(res.accepted).toBe(1);
    expect(t.store.get('sess-own').status).toBe('COMPLETED');
  });
});

/**
 * Batch ingest.
 *
 * A device flushing buffered events used to cost one SELECT per event, run
 * sequentially, before any write. Across a 1,000-screen fleet that was the
 * heaviest query pattern in the system — and it sits on the device's request
 * path, so it is the device that waits.
 */
describe('ProofOfPlayService.ingest — batching', () => {
  it('resolves a whole batch with ONE lookup, not one per event', async () => {
    const t = build();
    const events = Array.from({ length: 100 }, (_, i) => event({ playbackSessionId: `sess-${i}` }));

    const out = await t.service.ingest(DEVICE as any, { events } as any);

    expect(out).toEqual({ accepted: 100, rejected: 0 });
    expect(t.prisma.proofOfPlay.findMany).toHaveBeenCalledTimes(1);
    expect(t.prisma.proofOfPlay.findUnique).not.toHaveBeenCalled();
  });

  it('asks for exactly the session ids in the batch', async () => {
    const t = build();
    await t.service.ingest(
      DEVICE as any,
      {
        events: [event({ playbackSessionId: 'a' }), event({ playbackSessionId: 'b' })],
      } as any,
    );

    expect(t.prisma.proofOfPlay.findMany.mock.calls[0][0].where).toEqual({
      companyId: 'comp1',
      playbackSessionId: { in: ['a', 'b'] },
    });
  });

  it('does not query at all when every event has an unusable timestamp', async () => {
    const t = build();
    const out = await t.service.ingest(
      DEVICE as any,
      {
        events: [event({ startedAt: 'not-a-date' }), event({ startedAt: '1999-01-01T00:00:00Z' })],
      } as any,
    );

    expect(out).toEqual({ accepted: 0, rejected: 2 });
    expect(t.prisma.proofOfPlay.findMany).not.toHaveBeenCalled();
  });

  it('handles a start and its completion in the SAME batch', async () => {
    // The pre-read happens once, so the completion sees no existing row, loses
    // the create race with its own predecessor, and must fall through to the
    // terminal update rather than being lost.
    const t = build();
    const out = await t.service.ingest(
      DEVICE as any,
      {
        events: [
          event({ playbackSessionId: 'sess-x', eventType: 'ITEM_STARTED' }),
          event({
            playbackSessionId: 'sess-x',
            eventType: 'ITEM_COMPLETED',
            endedAt: new Date().toISOString(),
            durationMs: 9000,
          }),
        ],
      } as any,
    );

    expect(out.accepted).toBe(2);
    expect(t.store.get('sess-x')).toMatchObject({ status: 'COMPLETED', durationMs: 9000 });
  });

  it('counts a cross-tenant event as rejected, not accepted', async () => {
    const t = build();
    t.store.set('stolen', {
      playbackSessionId: 'stolen',
      status: 'STARTED',
      companyId: 'someone-else',
      screenId: 'their-screen',
    });

    const out = await t.service.ingest(
      DEVICE as any,
      {
        events: [
          event({ playbackSessionId: 'stolen', eventType: 'ITEM_COMPLETED' }),
          event({ playbackSessionId: 'mine' }),
        ],
      } as any,
    );

    expect(out).toEqual({ accepted: 1, rejected: 1 });
    // The foreign row is untouched.
    expect(t.store.get('stolen').status).toBe('STARTED');
  });

  it('keeps mixed good/bad batches partially successful', async () => {
    const t = build();
    const out = await t.service.ingest(
      DEVICE as any,
      {
        events: [
          event({ playbackSessionId: 'ok-1' }),
          event({ playbackSessionId: 'bad', startedAt: 'nope' }),
          event({ playbackSessionId: 'ok-2' }),
        ],
      } as any,
    );

    expect(out).toEqual({ accepted: 2, rejected: 1 });
  });
});

describe('ProofOfPlayService duration clamping', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  /**
   * Run STARTED then a terminal event and return the stored row. `startedAt` is
   * passed IN rather than returned, so a case can build an `endedAt` relative to
   * the same instant the session opened at.
   */
  async function complete(over: any, startedAt: string = new Date().toISOString()) {
    const t = build();
    await t.service.ingest(DEVICE as any, { events: [event({ startedAt })] });
    await t.service.ingest(DEVICE as any, {
      events: [event({ eventType: 'ITEM_COMPLETED', startedAt, ...over })],
    });
    return t.store.get('sess-1');
  }

  it('stores a plausible duration unchanged', async () => {
    expect((await complete({ durationMs: 15_000 })).durationMs).toBe(15_000);
  });

  it('caps a duration beyond the ceiling', async () => {
    // durationMs is summed into the advertiser-billing total. Unbounded, ONE
    // event from any device-token holder dominates every figure for the tenant
    // — and an Android TV box with no RTC reaches the same place by accident
    // when NTP lands mid-item.
    expect((await complete({ durationMs: Number.MAX_SAFE_INTEGER })).durationMs).toBe(DAY_MS);
  });

  it('keeps endedAt consistent with the clamped duration', async () => {
    // Clamping the number but keeping the device's endedAt would leave a row
    // that still encodes the implausible interval in its timestamps.
    const startedAt = new Date().toISOString();
    const row = await complete(
      {
        durationMs: 400 * DAY_MS,
        endedAt: new Date(Date.parse(startedAt) + 400 * DAY_MS).toISOString(),
      },
      startedAt,
    );
    expect(row.durationMs).toBe(DAY_MS);
    expect(row.endedAt.getTime() - Date.parse(startedAt)).toBe(DAY_MS);
  });

  it('caps an over-long interval reported as timestamps with no duration', async () => {
    // The same inflation without the durationMs field: a far-future endedAt
    // makes any report that subtracts the timestamps show the same figure.
    const startedAt = new Date().toISOString();
    const row = await complete(
      { endedAt: new Date(Date.parse(startedAt) + 400 * DAY_MS).toISOString() },
      startedAt,
    );
    expect(row.endedAt.getTime() - Date.parse(startedAt)).toBe(DAY_MS);
  });

  it('drops an endedAt that precedes startedAt', async () => {
    // A negative interval breaks every downstream range query and would render
    // as negative playback in a report.
    const startedAt = new Date().toISOString();
    const row = await complete(
      { endedAt: new Date(Date.parse(startedAt) - 60_000).toISOString() },
      startedAt,
    );
    expect(row.endedAt).toBeNull();
  });

  it('drops an unparseable endedAt rather than storing Invalid Date', async () => {
    expect((await complete({ endedAt: 'not-a-date' })).endedAt).toBeNull();
  });

  it('leaves a terminal event carrying no interval fields alone', async () => {
    const row = await complete({});
    expect(row.durationMs).toBeNull();
    expect(row.endedAt).toBeNull();
  });

  it('never records a negative duration', async () => {
    expect((await complete({ durationMs: -5000 })).durationMs).toBe(0);
  });
});
