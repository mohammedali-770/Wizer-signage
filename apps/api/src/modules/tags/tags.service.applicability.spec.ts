import { BadRequestException } from '@nestjs/common';
import { TagType } from '@prisma/client';

import { TagsService } from './tags.service';

function harness() {
  const prisma = {
    tag: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    $transaction: jest.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
  };
  const service = new TagsService(prisma as never, {} as never);
  return { service, prisma };
}

describe('TagsService selector applicability', () => {
  it('maps CONTENT applicability to CONTENT+BOTH at the database boundary', async () => {
    const { service, prisma } = harness();

    await service.list('company-1', { page: 1, pageSize: 50, applicableTo: 'CONTENT', search: 'promo' });

    expect(prisma.tag.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: 'company-1',
          type: { in: [TagType.CONTENT, TagType.BOTH] },
          name: { contains: 'promo', mode: 'insensitive' },
        },
        take: 50,
      }),
    );
    expect(prisma.tag.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ type: { in: [TagType.CONTENT, TagType.BOTH] } }),
    });
  });

  it('maps SCREEN applicability to SCREEN+BOTH', async () => {
    const { service, prisma } = harness();

    await service.list('company-1', { page: 1, pageSize: 50, applicableTo: 'SCREEN' });

    expect(prisma.tag.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ type: { in: [TagType.SCREEN, TagType.BOTH] } }),
      }),
    );
  });

  it('rejects ambiguous exact-type plus applicability filters', async () => {
    const { service, prisma } = harness();

    await expect(
      service.list('company-1', {
        page: 1,
        pageSize: 50,
        type: TagType.CONTENT,
        applicableTo: 'CONTENT',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
