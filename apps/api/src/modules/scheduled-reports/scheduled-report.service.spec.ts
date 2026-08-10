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
    createdById: 'u1',
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
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'u1',
        role: 'COMPANY_ADMIN',
        status: 'ACTIVE',
        companyId: 'comp1',
        deletedAt: null,
      }),
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          (where.OR ?? []).map((entry: any) => ({ email: entry.email.equals })),
        ),
      ),
    },
    $transaction: (ops: Promise<any>[]) => Promise.all(ops),
  };
  const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
  const exports = {
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
  it('create sets a nextRunAt, validates recipients, and logs', async () => {
    const t = build();
    const out = await t.service.create('comp1', ACTOR, {
      name: 'W',
      reportType: 'PROOF_OF_PLAY',
      frequency: 'WEEKLY',
      recipients: ['a@b.com'],
    } as any);
    expect(out.nextRunAt).not.toBeNull();
    expect(t.prisma.user.findMany).toHaveBeenCalled();
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'report.scheduled_created' }),
    );
  });

  it('rejects a recipient that is not an active user in the owning company', async () => {
    const t = build();
    t.prisma.user.findMany.mockResolvedValue([]);
    await expect(
      t.service.create('comp1', ACTOR, {
        name: 'W',
        reportType: 'PROOF_OF_PLAY',
        frequency: 'WEEKLY',
        recipients: ['external@example.com'],
      } as any),
    ).rejects.toThrow(/active users/i);
    expect(t.prisma.scheduledReport.create).not.toHaveBeenCalled();
  });

  it('runNow renders, stores, emails recipients, and records a SENT delivery', async () => {
    const t = build();
    t.prisma.scheduledReport.findFirst.mockResolvedValue(report());
    const out = await t.service.runNow('comp1', ACTOR, 'r1');
    expect(t.exports.dataset).toHaveBeenCalled();
    expect(t.storage.upload).toHaveBeenCalled();
    expect(t.email.sendEvent).toHaveBeenCalledWith(expect.objectContaining({ to: 'ops@comp.com' }));
    expect(t.email.sendEvent.mock.calls[0][0].text).toContain('link valid 4 hours');
    expect(out.status).toBe('SENT');
  });

  it('marks the delivery FAILED + alerts when every recipient email fails', async () => {
    const t = build();
    t.prisma.scheduledReport.findFirst.mockResolvedValue(report());
    t.email.sendEvent.mockResolvedValue({ ok: false, logId: 'e1' });
    const out = await t.service.runNow('comp1', ACTOR, 'r1');
    expect(t.storage.upload).toHaveBeenCalled();
    expect(out.status).toBe('FAILED');
    expect(t.alerts.raise).toHaveBeenCalledWith(expect.objectContaining({ type: 'report.failed' }));
  });

  it('records only a generic client-visible error when rendering fails', async () => {
    const t = build();
    t.prisma.scheduledReport.findFirst.mockResolvedValue(report());
    t.exports.dataset.mockRejectedValue(new Error('provider-secret-detail'));
    const out = await t.service.runNow('comp1', ACTOR, 'r1');
    expect(out.status).toBe('FAILED');
    expect(out.error).toBe('Scheduled report generation or delivery failed.');
    expect(out.error).not.toContain('provider-secret-detail');
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

  it('checks the dataset the report type maps to on create and update', async () => {
    const t = build();
    await t.service.create('comp1', ACTOR, {
      name: 'Billing',
      reportType: 'BILLING',
      frequency: 'MONTHLY',
      recipients: ['a@b.com'],
    } as any);
    expect(t.exports.assertDatasetAccess).toHaveBeenCalledWith(ACTOR, 'invoices');

    t.prisma.scheduledReport.findFirst.mockResolvedValue(report());
    await t.service.update('comp1', ACTOR, 'r1', { reportType: 'BILLING' } as any);
    expect(t.exports.assertDatasetAccess).toHaveBeenLastCalledWith(ACTOR, 'invoices');
  });

  it('disables a due report whose creator no longer exists, instead of running it', async () => {
    const t = build();
    t.prisma.scheduledReport.findMany.mockResolvedValue([
      report({ id: 'r-orphan', reportType: 'ACTIVITY_LOGS', createdById: 'deleted-user' }),
    ]);
    t.prisma.user.findUnique.mockResolvedValue(null);
    t.prisma.scheduledReport.update.mockResolvedValue({});

    const res = await t.service.runDue(new Date());
    expect(res.ran).toBe(0);
    expect(t.prisma.scheduledReport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r-orphan' },
        data: expect.objectContaining({ enabled: false, nextRunAt: null }),
      }),
    );
  });

  it('disables a due report whose creator has been deactivated', async () => {
    const t = build();
    t.prisma.scheduledReport.findMany.mockResolvedValue([report()]);
    t.prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      role: 'COMPANY_ADMIN',
      status: 'DISABLED',
      companyId: 'comp1',
      deletedAt: null,
    });

    const res = await t.service.runDue(new Date());
    expect(res.ran).toBe(0);
    expect(t.prisma.scheduledReport.update).toHaveBeenCalled();
  });

  it('disables a due report when a recipient is no longer an active company user', async () => {
    const t = build();
    t.prisma.scheduledReport.findMany.mockResolvedValue([report()]);
    t.prisma.user.findMany.mockResolvedValue([]);

    const res = await t.service.runDue(new Date());
    expect(res.ran).toBe(0);
    expect(res.failed).toBe(1);
    expect(t.email.sendEvent).not.toHaveBeenCalled();
    expect(t.prisma.scheduledReport.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ enabled: false }) }),
    );
  });

  it('still runs a report whose creator and recipients are active and entitled', async () => {
    const t = build();
    t.prisma.scheduledReport.findMany.mockResolvedValue([report()]);
    const res = await t.service.runDue(new Date());
    expect(res.ran).toBe(1);
  });
});
