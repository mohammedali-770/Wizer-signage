import { InvoiceStatus } from '@prisma/client';

import { InvoicesService } from './invoices.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

function build() {
  const prisma: any = {
    company: { findFirst: jest.fn().mockResolvedValue({ id: 'c1' }) },
    subscription: { findFirst: jest.fn() },
    invoice: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockImplementation(({ data }: any) => Promise.resolve({ id: 'inv-1', ...data })),
      findUnique: jest.fn(),
      update: jest
        .fn()
        .mockImplementation(({ data }: any) => Promise.resolve({ id: 'inv-1', ...data })),
    },
  };
  const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new InvoicesService(prisma, activityLog as any);
  return { service, prisma, activityLog };
}

const actor: any = { userId: 'admin-1', isSuperAdmin: true, companyId: null, role: 'SUPER_ADMIN' };

describe('InvoicesService.create', () => {
  it('computes totals, allocates a number, and logs', async () => {
    const t = build();
    await t.service.create(actor, {
      companyId: 'c1',
      lineItems: [
        { description: 'Subscription', quantity: 2, unitPrice: 10 },
        { description: 'Setup', quantity: 1, unitPrice: 5.5 },
      ],
      tax: 2.5,
    });
    expect(t.prisma.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subtotal: 25.5,
          tax: 2.5,
          total: 28,
          number: expect.stringMatching(/^INV-\d{4}-00001$/),
        }),
      }),
    );
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'invoice.created' }),
    );
  });
});

describe('InvoicesService.updateStatus', () => {
  it('marks paid (sets paidAt) and logs the change', async () => {
    const t = build();
    t.prisma.invoice.findUnique.mockResolvedValue({
      id: 'inv-1',
      companyId: 'c1',
      status: InvoiceStatus.UNPAID,
      number: 'INV-2026-00001',
      issuedAt: new Date(),
    });

    await t.service.updateStatus(actor, 'inv-1', InvoiceStatus.PAID);

    expect(t.prisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PAID', paidAt: expect.any(Date) }),
      }),
    );
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'invoice.status_changed' }),
    );
  });
});
