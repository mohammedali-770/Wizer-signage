import { ProofOfPlayService } from './proof-of-play.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('ProofOfPlayService tenant-scoped idempotency lookup', () => {
  it('never pre-reads a client session id outside the authenticated company', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const create = jest.fn().mockResolvedValue({ id: 'pop-1' });
    const prisma: any = {
      screen: {
        findFirst: jest.fn().mockResolvedValue({ id: 'screen-1', locationId: 'location-1' }),
      },
      proofOfPlay: {
        findMany,
        create,
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const service = new ProofOfPlayService(prisma);

    const result = await service.ingest(
      {
        id: 'device-1',
        deviceId: 'serial-1',
        screenId: 'screen-1',
        companyId: 'company-1',
      } as any,
      {
        events: [
          {
            eventType: 'ITEM_STARTED',
            playbackSessionId: 'session-from-device',
            startedAt: new Date().toISOString(),
            contentType: 'IMAGE',
          },
        ],
      } as any,
    );

    expect(result).toEqual({ accepted: 1, rejected: 0 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: 'company-1',
          playbackSessionId: { in: ['session-from-device'] },
        },
      }),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'company-1',
          screenId: 'screen-1',
          playbackSessionId: 'session-from-device',
        }),
      }),
    );
  });
});
