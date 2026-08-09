import { ProofOfPlayStatus } from '@prisma/client';

import { ProofOfPlayService } from './proof-of-play.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const DEVICE = {
  id: 'dev1',
  companyId: 'comp1',
  screenId: 'screen1',
  deviceId: 'device-serial-1',
} as const;

const SCREEN = { id: 'screen1', locationId: 'loc1' } as const;

function event(overrides: Record<string, unknown> = {}) {
  return {
    eventType: 'ITEM_STARTED',
    playbackSessionId: 'session-1',
    startedAt: '2026-08-01T10:00:00.000Z',
    contentType: 'IMAGE',
    ...overrides,
  };
}

function build() {
  const prisma = {
    screen: {
      findFirst: jest.fn().mockResolvedValue(SCREEN),
    },
    proofOfPlay: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'pop-new', ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  } as any;
  return { prisma, service: new ProofOfPlayService(prisma) };
}

describe('ProofOfPlayService.ingest', () => {
  it('rejects every event when the authenticated device screen cannot be loaded inside its company', async () => {
    const t = build();
    t.prisma.screen.findFirst.mockResolvedValue(null);

    const out = await t.service.ingest(DEVICE as any, { events: [event()] } as any);

    expect(out).toEqual({ accepted: 0, rejected: 1 });
    expect(t.prisma.proofOfPlay.findMany).not.toHaveBeenCalled();
  });

  it('creates a start event under the authenticated company, screen, and device', async () => {
    const t = build();

    const out = await t.service.ingest(DEVICE as any, { events: [event()] } as any);

    expect(out).toEqual({ accepted: 1, rejected: 0 });
    expect(t.prisma.proofOfPlay.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'comp1',
        screenId: 'screen1',
        deviceId: 'dev1',
        locationId: 'loc1',
        playbackSessionId: 'session-1',
      }),
    });
  });

  it('rejects a terminal event whose session belongs to a different screen inside the tenant', async () => {
    const t = build();
    t.prisma.proofOfPlay.findMany.mockResolvedValue([
      { id: 'pop-other', playbackSessionId: 'session-1', screenId: 'screen-other', status: 'STARTED' },
    ]);

    const out = await t.service.ingest(
      DEVICE as any,
      {
        events: [
          event({
            eventType: 'ITEM_COMPLETED',
            endedAt: '2026-08-01T10:00:05.000Z',
            durationMs: 5000,
          }),
        ],
      } as any,
    );

    expect(out).toEqual({ accepted: 0, rejected: 1 });
    expect(t.prisma.proofOfPlay.updateMany).not.toHaveBeenCalled();
  });

  it('tenant-scopes a terminal update by company and screen', async () => {
    const t = build();
    t.prisma.proofOfPlay.findMany.mockResolvedValue([
      { id: 'pop-1', playbackSessionId: 'session-1', screenId: 'screen1', status: 'STARTED' },
    ]);

    const out = await t.service.ingest(
      DEVICE as any,
      {
        events: [
          event({
            eventType: 'ITEM_COMPLETED',
            endedAt: '2026-08-01T10:00:05.000Z',
            durationMs: 5000,
          }),
        ],
      } as any,
    );

    expect(out).toEqual({ accepted: 1, rejected: 0 });
    expect(t.prisma.proofOfPlay.updateMany).toHaveBeenCalledWith({
      where: {
        playbackSessionId: 'session-1',
        companyId: 'comp1',
        screenId: 'screen1',
      },
      data: expect.objectContaining({ status: ProofOfPlayStatus.COMPLETED }),
    });
  });
});

describe('ProofOfPlayService.ingest — batching', () => {
  it('pre-loads existing sessions once for a full batch rather than once per event', async () => {
    const t = build();
    const events = Array.from({ length: 100 }, (_, i) => event({ playbackSessionId: `sess-${i}` }));

    const out = await t.service.ingest(DEVICE as any, { events } as any);

    expect(out).toEqual({ accepted: 100, rejected: 0 });
    expect(t.prisma.proofOfPlay.findMany).toHaveBeenCalledTimes(1);
    expect(t.prisma.proofOfPlay.findUnique).not.toHaveBeenCalled();
  });

  it('asks for exactly the session ids in the batch, inside the authenticated tenant', async () => {
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
});
