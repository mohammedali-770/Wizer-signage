import { ScheduledReportService } from './scheduled-report.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const ACTOR = { userId: 'u1', companyId: 'comp1' } as any;

function report(over: any = {}) {
  return {
    id: 'r1',
    companyId: 'comp1',
    name: 'Weekly PoP',
    reportType: 'PROOF_OF_PLAY',
    format: 'CSV',
    frequency: 'WEEKLY',
    recipients: ['ops@comp.com'],
    filters: {},
    enabled: true,
    lastRunAt: null,
    nextRunAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function build() {
  const store = new Map<string, any>();
  const deliveries: any[] = [];
  let seq = 0;
  const prisma: any = {
    scheduledReport: {
      create: jest.fn(({ data }: any) => {
        const row = report({ ...data, id: `r${++seq}` });
        store.set(row.id, row);
        return Promise.resolve(row);
      }),
      findFirst: jest.fn(({ where }: any) => Promise.resolve(store.get(where.id) ?? null)),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(({ where, data }: any) => {
        const row = store.get(where.id) ?? report({ id: where.id });
        Object.assign(row, data);
        store.set(where.id, row);
        return Promise.resolve(row);
      }),
      count: jest.fn().mockResolvedValue(0),
    },
    scheduledReportDelivery: {
      create: jest.fn(({ data }: any) => {
        const row = { id: `d${deliveries.length + 1}`, ...data, createdAt: new Date() };
        deliveries.push(row);
        return Promise.resolve(row);
      }),
      update: jest.fn(({ where, data }: any) => {
        const row = deliveries.find((d) => d.id === where.id);
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: (ops: Promise<any>[]) => Promise.all(ops),
  };
  const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
  const exports = {
    // Mirrors ExportService: throws when the caller may not export the dataset.
    // Default is permissive; individual tests make it throw.
    assertDatasetAccess: jest.fn(),
    dataset: jest.fn().mockResolvedValue({ title: 'PoP', headers: ['a'], rows: [['1']] }),
    render: jest
      .fn()
      .mockResolvedValue({ contentType: 'text/csv', filename: 'pop.csv', body: 'a\r\n1' }),
  };
  const email = { sendEvent: jest.fn().mockResolvedValue({ ok: true, logId: 'e1' }) };
  const alerts = { raise: jest.fn().mockResolvedValue({ created: true }) };
  const storage = {
    upload: jest.fn().mockResolvedValue(undefined),
    getSignedUrl: jest.fn().mockResolvedValue('https://signed/url'),
  };
  const service = new ScheduledReportService(
    prisma,
    activityLog as any,
    exports as any,
    email as any,
    alerts as any,
    storage as any,
  );
  return { service, prisma, activityLog, exports, email, alerts, storage, deliveries };
}

describe('ScheduledReportService', () => {
  it('create sets a nextRunAt and logs', async () => {
    const t = build();
    const out = await t.service.create('comp1', ACTOR, {
      name: 'W',
      reportType: 'PROOF_OF_PLAY',
      frequency: 'WEEKLY',
      recipients: ['a@b.com'],
    } as any);
    expect(out.nextRunAt).not.toBeNull();
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'report.scheduled_created' }),
    );
  });

  it('runNow renders, stores, emails recipients, and records a SENT delivery', async () => {
    const t = build();
    t.prisma.scheduledReport.findFirst.mockResolvedValue(report());
    const out = await t.service.runNow('comp1', ACTOR, 'r1');
    expect(t.exports.dataset).toHaveBeenCalled();
    expect(t.storage.upload).toHaveBeenCalled();
    expect(t.email.sendEvent).toHaveBeenCalledWith(expect.objectContaining({ to: 'ops@comp.com' }));
    expect(out.status).toBe('SENT');
  });

  it('marks the delivery FAILED + alerts when every recipient email fails (file still rendered)', async () => {
    const t = build();
    t.prisma.scheduledReport.findFirst.mockResolvedValue(report());
    t.email.sendEvent.mockResolvedValue({ ok: false, logId: 'e1' });
    const out = await t.service.runNow('comp1', ACTOR, 'r1');
    expect(t.storage.upload).toHaveBeenCalled(); // rendered + stored
    expect(out.status).toBe('FAILED');
    expect(t.alerts.raise).toHaveBeenCalledWith(expect.objectContaining({ type: 'report.failed' }));
  });

  it('records a FAILED delivery + raises an alert when rendering fails (no crash)', async () => {
    const t = build();
    t.prisma.scheduledReport.findFirst.mockResolvedValue(report());
    t.exports.dataset.mockRejectedValue(new Error('boom'));
    const out = await t.service.runNow('comp1', ACTOR, 'r1');
    expect(out.status).toBe('FAILED');
    expect(t.alerts.raise).toHaveBeenCalledWith(expect.objectContaining({ type: 'report.failed' }));
  });

  it('runDue runs only enabled reports that are due', async () => {
    const t = build();
    t.prisma.scheduledReport.findMany.mockResolvedValue([report({ id: 'r1' })]);
    const res = await t.service.runDue(new Date('2026-06-20T00:00:00Z'));
    expect(res.ran).toBe(1);
    expect(t.prisma.scheduledReport.findMany.mock.calls[0][0].where).toMatchObject({
      enabled: true,
    });
  });

  it('setEnabled(false) clears nextRunAt', async () => {
    const t = build();
    t.prisma.scheduledReport.findFirst.mockResolvedValue(report());
    const out = await t.service.setEnabled('comp1', ACTOR, 'r1', false);
    expect(out.nextRunAt).toBeNull();
  });
});

/**
 * Scheduling must not be a bypass for the interactive export permission, and a
 * schedule must not outlive its creator's access.
 *
 * A schedule is a standing grant: it mails a dataset to fixed addresses forever.
 * Previously nothing re-checked the creator, so disabling a departing employee's
 * account revoked their sessions and left the platform mailing them the tenant's
 * audit trail and invoice ledger every week, with no way to see or revoke it.
 */
describe('ScheduledReportService authority', () => {
  it('refuses to create a schedule the actor could not export interactively', async () => {
    const t = build();
    t.exports.assertDatasetAccess.mockImplementation(() => {
      throw new Error('forbidden');
    });

    await expect(
      t.service.create('comp1', ACTOR, {
        name: 'Audit',
        reportType: 'ACTIVITY_LOGS',
        frequency: 'WEEKLY',
        recipients: ['a@b.com'],
      } as any),
    ).rejects.toThrow(/forbidden/);

    expect(t.prisma.scheduledReport.create).not.toHaveBeenCalled();
  });

  it('checks the dataset the report type maps to', async () => {
    const t = build();
    await t.service.create('comp1', ACTOR, {
      name: 'Billing',
      reportType: 'BILLING',
      frequency: 'MONTHLY',
      recipients: ['a@b.com'],
    } as any);
    expect(t.exports.assertDatasetAccess).toHaveBeenCalledWith(ACTOR, 'invoices');
  });

  it('disables a due report whose creator no longer exists, instead of running it', async () => {
    const t = build();
    t.prisma.scheduledReport.findMany = jest.fn().mockResolvedValue([
      {
        id: 'r-orphan',
        companyId: 'comp1',
        reportType: 'ACTIVITY_LOGS',
        format: 'CSV',
        frequency: 'WEEKLY',
        recipients: ['gone@example.com'],
        filters: {},
        enabled: true,
        createdById: 'deleted-user',
      },
    ]);
    t.prisma.user = { findUnique: jest.fn().mockResolvedValue(null) };
    t.prisma.scheduledReport.update = jest.fn().mockResolvedValue({});

    const res = await t.service.runDue(new Date());

    expect(res.ran).toBe(0); // never rendered, never emailed
    expect(t.prisma.scheduledReport.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'r-orphan' }, data: { enabled: false } }),
    );
  });

  it('disables a due report whose creator has been deactivated', async () => {
    const t = build();
    t.prisma.scheduledReport.findMany = jest.fn().mockResolvedValue([
      {
        id: 'r1',
        companyId: 'comp1',
        reportType: 'PROOF_OF_PLAY',
        format: 'CSV',
        frequency: 'WEEKLY',
        recipients: ['x@y.com'],
        filters: {},
        enabled: true,
        createdById: 'u1',
      },
    ]);
    t.prisma.user = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'u1',
        role: 'COMPANY_ADMIN',
        status: 'DISABLED',
        companyId: 'comp1',
        deletedAt: null,
      }),
    };
    t.prisma.scheduledReport.update = jest.fn().mockResolvedValue({});

    const res = await t.service.runDue(new Date());
    expect(res.ran).toBe(0);
    expect(t.prisma.scheduledReport.update).toHaveBeenCalled();
  });

  it('still runs a report whose creator is active and entitled', async () => {
    const t = build();
    t.prisma.scheduledReport.findMany = jest.fn().mockResolvedValue([
      {
        id: 'r1',
        companyId: 'comp1',
        reportType: 'PROOF_OF_PLAY',
        format: 'CSV',
        frequency: 'WEEKLY',
        recipients: ['x@y.com'],
        filters: {},
        enabled: true,
        createdById: 'u1',
      },
    ]);
    t.prisma.user = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'u1',
        role: 'COMPANY_ADMIN',
        status: 'ACTIVE',
        companyId: 'comp1',
        deletedAt: null,
      }),
    };

    const res = await t.service.runDue(new Date());
    expect(res.ran).toBe(1);
  });
});
