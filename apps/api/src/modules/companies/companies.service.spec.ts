import { BadRequestException } from '@nestjs/common';

import { CompaniesService } from './companies.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

function build() {
  const prisma: any = {
    company: { findFirst: jest.fn(), update: jest.fn() },
  };
  const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
  const sessions = { revokeAllForCompany: jest.fn().mockResolvedValue(3) };
  const usageLimits = { evaluate: jest.fn() };
  const password = { hash: jest.fn().mockResolvedValue('hashed-pin') };
  const service = new CompaniesService(
    prisma,
    activityLog as any,
    sessions as any,
    usageLimits as any,
    password as any,
  );
  return { service, prisma, activityLog, sessions };
}

const actor: any = { userId: 'admin-1', isSuperAdmin: true, companyId: null, role: 'SUPER_ADMIN' };

describe('CompaniesService.suspend', () => {
  it('suspends an active company, revokes its sessions, and logs', async () => {
    const t = build();
    t.prisma.company.findFirst.mockResolvedValue({ id: 'c1', status: 'ACTIVE' });
    t.prisma.company.update.mockResolvedValue({
      id: 'c1',
      status: 'SUSPENDED',
      defaultKioskPin: null,
    });

    await t.service.suspend(actor, 'c1', 'non-payment');

    expect(t.prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SUSPENDED', suspendedAt: expect.any(Date) }),
      }),
    );
    expect(t.sessions.revokeAllForCompany).toHaveBeenCalledWith('c1', 'company_suspended');
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'company.suspended' }),
    );
  });

  it('rejects suspending an already-suspended company', async () => {
    const t = build();
    t.prisma.company.findFirst.mockResolvedValue({ id: 'c1', status: 'SUSPENDED' });
    await expect(t.service.suspend(actor, 'c1')).rejects.toBeInstanceOf(BadRequestException);
    expect(t.prisma.company.update).not.toHaveBeenCalled();
  });
});

describe('CompaniesService.reactivate', () => {
  it('reactivates a suspended company and logs', async () => {
    const t = build();
    t.prisma.company.findFirst.mockResolvedValue({ id: 'c1', status: 'SUSPENDED' });
    t.prisma.company.update.mockResolvedValue({
      id: 'c1',
      status: 'ACTIVE',
      defaultKioskPin: null,
    });

    await t.service.reactivate(actor, 'c1');

    expect(t.prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ACTIVE', suspendedAt: null }),
      }),
    );
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'company.reactivated' }),
    );
  });

  it('rejects reactivating a company that is not suspended', async () => {
    const t = build();
    t.prisma.company.findFirst.mockResolvedValue({ id: 'c1', status: 'ACTIVE' });
    await expect(t.service.reactivate(actor, 'c1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
