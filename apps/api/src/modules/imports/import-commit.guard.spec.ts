import { BadRequestException } from '@nestjs/common';

import {
  IMPORT_COMMIT_STALE_MS,
  ImportCancelGuard,
  ImportCommitGuard,
} from './import-commit.guard';

/* eslint-disable @typescript-eslint/no-explicit-any */

function context(user: any, id = 'job-1'): any {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user, params: { id } }),
    }),
  };
}

const tenantUser = {
  userId: 'u1',
  companyId: 'c1',
  isSuperAdmin: false,
  role: 'COMPANY_ADMIN',
};

const superAdmin = {
  userId: 'sa1',
  companyId: null,
  isSuperAdmin: true,
  role: 'SUPER_ADMIN',
};

describe('ImportCommitGuard', () => {
  it('allows the request only when PostgreSQL atomically claims one VALIDATED job', async () => {
    const prisma = { $executeRaw: jest.fn().mockResolvedValue(1) } as any;
    const guard = new ImportCommitGuard(prisma);

    await expect(guard.canActivate(context(tenantUser))).resolves.toBe(true);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('rejects a duplicate/racing commit when no row can be claimed', async () => {
    const prisma = { $executeRaw: jest.fn().mockResolvedValue(0) } as any;
    const guard = new ImportCommitGuard(prisma);

    await expect(guard.canActivate(context(tenantUser))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('supports a super-admin claim without requiring a tenant company id', async () => {
    const prisma = { $executeRaw: jest.fn().mockResolvedValue(1) } as any;
    const guard = new ImportCommitGuard(prisma);

    await expect(guard.canActivate(context(superAdmin))).resolves.toBe(true);
  });
});

describe('ImportCancelGuard', () => {
  it('cancels exactly one eligible uncommitted job', async () => {
    const prisma = { $executeRaw: jest.fn().mockResolvedValue(1) } as any;
    const guard = new ImportCancelGuard(prisma);

    await expect(guard.canActivate(context(tenantUser))).resolves.toBe(true);
  });

  it('rejects cancellation while a fresh commit claim owns the job', async () => {
    const prisma = { $executeRaw: jest.fn().mockResolvedValue(0) } as any;
    const guard = new ImportCancelGuard(prisma);

    await expect(guard.canActivate(context(tenantUser))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('uses a finite stale-claim window so an interrupted job can eventually be cancelled', () => {
    expect(IMPORT_COMMIT_STALE_MS).toBe(2 * 60 * 60 * 1000);
  });
});
