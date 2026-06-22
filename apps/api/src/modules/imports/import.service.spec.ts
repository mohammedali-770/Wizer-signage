import { ForbiddenException } from '@nestjs/common';

import { ImportService } from './import.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const ACTOR = { userId: 'u1', companyId: 'comp1', isSuperAdmin: false } as any;
const COMPANY_SCOPE = { companyId: 'comp1', isSuperAdmin: false };

function file(csv: string, name = 'import.csv'): any {
  return { originalname: name, buffer: Buffer.from(csv, 'utf-8') };
}

function build() {
  const jobs = new Map<string, any>();
  let seq = 0;
  const prisma: any = {
    importJob: {
      create: jest.fn(({ data }: any) => {
        const row = { id: `j${++seq}`, ...data, createdAt: new Date(), updatedAt: new Date() };
        jobs.set(row.id, row);
        return Promise.resolve(row);
      }),
      findFirst: jest.fn(({ where }: any) => Promise.resolve(jobs.get(where.id) ?? null)),
      update: jest.fn(({ where, data }: any) => {
        const row = jobs.get(where.id);
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    location: { findFirst: jest.fn().mockResolvedValue({ id: 'loc1' }) },
    $transaction: (ops: Promise<any>[]) => Promise.all(ops),
  };
  const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
  const locations = { create: jest.fn().mockResolvedValue({ id: 'loc-new' }) };
  const screens = { create: jest.fn().mockResolvedValue({ id: 'scr-new' }) };
  const screenGroups = { create: jest.fn().mockResolvedValue({ id: 'g-new' }) };
  const tags = { create: jest.fn().mockResolvedValue({ id: 't-new' }) };
  const invitations = { create: jest.fn().mockResolvedValue({ id: 'inv-new' }) };
  const companies = { create: jest.fn().mockResolvedValue({ id: 'co-new' }) };
  const service = new ImportService(
    prisma,
    activityLog as any,
    locations as any,
    screens as any,
    screenGroups as any,
    tags as any,
    invitations as any,
    companies as any,
  );
  return { service, prisma, activityLog, locations, invitations, jobs };
}

describe('ImportService', () => {
  it('generates a CSV template with the expected header', () => {
    const t = build();
    const csv = t.service.template('LOCATION' as any);
    expect(csv.split('\r\n')[0]).toBe('name,code,city,region,country,timezone');
  });

  it('validates rows on upload — flags a row missing a required field', async () => {
    const t = build();
    const job = await t.service.upload(
      COMPANY_SCOPE,
      ACTOR,
      'LOCATION' as any,
      file('name,code\nMain,MB1\n,MB2'),
    );
    expect(job.totalRows).toBe(2);
    expect(job.validRows).toBe(1);
    expect(job.invalidRows).toBe(1);
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'import.uploaded', category: 'IMPORT' }),
    );
  });

  it('refuses a Super-Admin-only COMPANY import for a company admin', async () => {
    const t = build();
    await expect(
      t.service.upload(COMPANY_SCOPE, ACTOR, 'COMPANY' as any, file('name\nAcme')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('commit reuses the entity create service for each valid row (tenant companyId, not the file)', async () => {
    const t = build();
    const job = await t.service.upload(
      COMPANY_SCOPE,
      ACTOR,
      'LOCATION' as any,
      file('name,code\nMain,MB1\nBranch,MB2'),
    );
    const result = await t.service.commit(COMPANY_SCOPE, ACTOR, job.id);
    expect(result.committed).toBe(2);
    expect(t.locations.create).toHaveBeenCalledTimes(2);
    // companyId comes from the job's tenant scope (comp1), never from the row.
    expect(t.locations.create).toHaveBeenCalledWith(
      'comp1',
      expect.anything(),
      expect.objectContaining({ name: 'Main' }),
    );
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'import.committed' }),
    );
  });

  it('surfaces a plan-limit / uniqueness failure as a per-row error without aborting the batch', async () => {
    const t = build();
    t.locations.create
      .mockResolvedValueOnce({ id: 'ok' })
      .mockRejectedValueOnce(new ForbiddenException('Plan limit reached for locations.'));
    const job = await t.service.upload(COMPANY_SCOPE, ACTOR, 'LOCATION' as any, file('name\nA\nB'));
    const result = await t.service.commit(COMPANY_SCOPE, ACTOR, job.id);
    expect(result.committed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.rowErrors[0]?.errors[0]).toMatch(/plan limit/i);
  });

  it('rejects a file missing the required key column with a clear error', async () => {
    const t = build();
    await expect(
      t.service.upload(COMPANY_SCOPE, ACTOR, 'LOCATION' as any, file('foo,bar\nx,y')),
    ).rejects.toThrow(/required "name" column/i);
  });

  it('rejects a header-only file (no data rows)', async () => {
    const t = build();
    await expect(
      t.service.upload(COMPANY_SCOPE, ACTOR, 'LOCATION' as any, file('name,code')),
    ).rejects.toThrow(/no data rows/i);
  });

  it('rejects a USER row with an invalid email or SUPER_ADMIN role', async () => {
    const t = build();
    const job = await t.service.upload(
      COMPANY_SCOPE,
      ACTOR,
      'USER' as any,
      file(
        'email,name,role\nbademail,No At,VIEWER\nsuper@x.com,Boss,SUPER_ADMIN\nok@x.com,Fine,VIEWER',
      ),
    );
    expect(job.validRows).toBe(1); // only the third row is valid
    expect(job.invalidRows).toBe(2);
  });
});
