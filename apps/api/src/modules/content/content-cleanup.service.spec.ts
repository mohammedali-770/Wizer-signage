import { ContentCleanupService } from './content-cleanup.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

function build() {
  const prisma: any = {
    content: {
      findMany: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const storage = { remove: jest.fn().mockResolvedValue(undefined) };
  const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new ContentCleanupService(prisma, storage as any, activityLog as any);
  return { service, prisma, storage, activityLog };
}

describe('ContentCleanupService.purgeExpiredTrash', () => {
  it('removes the file and marks DELETED for trash older than 14 days, and logs', async () => {
    const t = build();
    t.prisma.content.findMany.mockResolvedValue([
      { id: 'c1', companyId: 'comp1', storageKey: 'companies/comp1/content/c1/a.png' },
    ]);

    const count = await t.service.purgeExpiredTrash('comp1');

    expect(count).toBe(1);
    // It queries TRASH items past the retention cutoff.
    expect(t.prisma.content.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'TRASH', companyId: 'comp1' }),
      }),
    );
    expect(t.storage.remove).toHaveBeenCalledWith('companies/comp1/content/c1/a.png');
    expect(t.prisma.content.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DELETED', deletedAt: expect.any(Date) }),
      }),
    );
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'content.cleanup_deleted' }),
    );
  });

  it('does nothing when there is no eligible trash', async () => {
    const t = build();
    t.prisma.content.findMany.mockResolvedValue([]);
    expect(await t.service.purgeExpiredTrash()).toBe(0);
    expect(t.storage.remove).not.toHaveBeenCalled();
  });
});
