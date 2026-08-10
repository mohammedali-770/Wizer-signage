import { ImportStatus, UserRole, UserStatus } from '@prisma/client';

import { ImportCommitWorkerService } from './import-commit-worker.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

function build() {
  const prisma: any = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'job-1' }]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    importJob: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'job-1',
        companyId: 'company-1',
        createdById: 'user-1',
      }),
      update: jest.fn().mockResolvedValue(undefined),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'user-1',
        email: 'admin@example.com',
        role: UserRole.COMPANY_ADMIN,
        companyId: 'company-1',
        status: UserStatus.ACTIVE,
        deletedAt: null,
      }),
    },
  };
  const imports: any = {
    commit: jest.fn().mockResolvedValue({ status: ImportStatus.COMMITTED }),
  };
  return { prisma, imports, service: new ImportCommitWorkerService(prisma, imports) };
}

describe('ImportCommitWorkerService', () => {
  it('atomically claims and processes a queued import with its original creator authority', async () => {
    const t = build();
    await expect(t.service.run()).resolves.toEqual({ claimed: 1, completed: 1, failed: 0 });
    expect(t.prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(t.imports.commit).toHaveBeenCalledWith(
      { companyId: 'company-1', isSuperAdmin: false },
      expect.objectContaining({
        userId: 'user-1',
        companyId: 'company-1',
        role: UserRole.COMPANY_ADMIN,
      }),
      'job-1',
    );
  });

  it('skips a row lost to another worker before the atomic claim', async () => {
    const t = build();
    t.prisma.$executeRaw.mockResolvedValue(0);
    await expect(t.service.run()).resolves.toEqual({ claimed: 0, completed: 0, failed: 0 });
    expect(t.imports.commit).not.toHaveBeenCalled();
  });

  it('fails closed when the creator is no longer active and never replays entity writes', async () => {
    const t = build();
    t.prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'admin@example.com',
      role: UserRole.COMPANY_ADMIN,
      companyId: 'company-1',
      status: UserStatus.DISABLED,
      deletedAt: null,
    });
    await expect(t.service.run()).resolves.toEqual({ claimed: 1, completed: 0, failed: 1 });
    expect(t.imports.commit).not.toHaveBeenCalled();
    expect(t.prisma.importJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({ status: ImportStatus.FAILED }),
      }),
    );
  });

  it('does not process more jobs than the worker query returns and runs them sequentially', async () => {
    const t = build();
    t.prisma.$queryRaw.mockResolvedValue([{ id: 'job-1' }, { id: 'job-2' }]);
    t.prisma.importJob.findUnique.mockImplementation(({ where }: any) =>
      Promise.resolve({ id: where.id, companyId: 'company-1', createdById: 'user-1' }),
    );
    await expect(t.service.run()).resolves.toEqual({ claimed: 2, completed: 2, failed: 0 });
    expect(t.imports.commit).toHaveBeenCalledTimes(2);
  });
});
