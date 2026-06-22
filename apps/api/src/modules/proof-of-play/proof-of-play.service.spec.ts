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
    const started = event();
    const ended = new Date().toISOString();
    await t.service.ingest(DEVICE as any, { events: [started] });
    await t.service.ingest(DEVICE as any, {
      events: [event({ eventType: 'ITEM_COMPLETED', endedAt: ended, durationMs: 9000 })],
    });
    const row = t.store.get('sess-1');
    expect(row.status).toBe('COMPLETED');
    expect(row.durationMs).toBe(9000);
    expect(row.endedAt).toEqual(new Date(ended));
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
