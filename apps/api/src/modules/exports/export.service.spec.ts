import { ForbiddenException } from '@nestjs/common';

import { ExportService } from './export.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const COMPANY = { companyId: 'comp1', isSuperAdmin: false };

function build() {
  const prisma: any = {
    proofOfPlay: {
      findMany: jest.fn().mockResolvedValue([
        {
          startedAt: new Date('2026-06-15T10:00:00Z'),
          endedAt: null,
          screen: { name: 'Lobby' },
          screenId: 's1',
          contentId: 'c1',
          sourceType: 'SCHEDULE',
          playbackSource: 'LOCAL_CACHE',
          status: 'COMPLETED',
          durationMs: 9000,
          offlinePlayback: false,
        },
      ]),
    },
    invoice: { findMany: jest.fn().mockResolvedValue([]) },
    company: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return { service: new ExportService(prisma), prisma };
}

describe('ExportService', () => {
  it('builds a company-scoped proof-of-play dataset', async () => {
    const t = build();
    const data = await t.service.dataset(COMPANY, 'proof-of-play', {});
    expect(t.prisma.proofOfPlay.findMany.mock.calls[0][0].where).toMatchObject({
      companyId: 'comp1',
    });
    expect(data.headers[0]).toBe('startedAt');
    expect(data.rows).toHaveLength(1);
  });

  it('renders CSV with a header row', async () => {
    const t = build();
    const data = await t.service.dataset(COMPANY, 'proof-of-play', {});
    const out = await t.service.render(data, 'CSV', 'proof-of-play');
    expect(out.contentType).toContain('text/csv');
    expect((out.body as string).split('\r\n')[0]).toContain('startedAt');
    expect(out.filename).toMatch(/^proof-of-play-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('renders XLSX as a Buffer', async () => {
    const t = build();
    const data = await t.service.dataset(COMPANY, 'proof-of-play', {});
    const out = await t.service.render(data, 'XLSX', 'proof-of-play');
    expect(Buffer.isBuffer(out.body)).toBe(true);
    expect(out.filename.endsWith('.xlsx')).toBe(true);
  });

  it('forbids the companies dataset for non-super-admins (no cross-company data)', async () => {
    const t = build();
    await expect(t.service.dataset(COMPANY, 'companies', {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('invoices export works (financial data is exportable, never deleted)', async () => {
    const t = build();
    const data = await t.service.dataset(COMPANY, 'invoices', {});
    expect(t.prisma.invoice.findMany).toHaveBeenCalled();
    expect(data.title).toBe('Invoices');
  });
});

/**
 * Per-dataset export authority.
 *
 * `GET /exports/:type` is gated on `report:read`, which lives in READ_ONLY and
 * is therefore held by VIEWER. That single gate covered four very different
 * boundaries: the interactive routes require `activity:read` (COMPANY_ADMIN) for
 * the audit trail and SUPER_ADMIN for billing, but exporting the SAME data
 * required neither — so a VIEWER could pull the tenant's full audit trail and
 * invoice ledger as a spreadsheet.
 */
describe('ExportService.assertDatasetAccess', () => {
  const service = new ExportService({} as any);

  const user = (role: string): any => ({
    userId: 'u1',
    role,
    companyId: role === 'SUPER_ADMIN' ? null : 'comp1',
    isSuperAdmin: role === 'SUPER_ADMIN',
  });

  const allows = (role: string, dataset: any): boolean => {
    try {
      service.assertDatasetAccess(user(role), dataset);
      return true;
    } catch {
      return false;
    }
  };

  describe('audit trail requires activity:read, not merely report:read', () => {
    it.each(['VIEWER', 'CONTENT_MANAGER', 'LOCATION_MANAGER'])('denies %s', (role) => {
      expect(allows(role, 'activity-logs')).toBe(false);
    });

    it.each(['COMPANY_ADMIN', 'SUPER_ADMIN'])('allows %s', (role) => {
      expect(allows(role, 'activity-logs')).toBe(true);
    });

    it('names the missing permission', () => {
      expect(() => service.assertDatasetAccess(user('VIEWER'), 'activity-logs' as any)).toThrow(
        /activity:read/,
      );
    });
  });

  describe('billing + platform datasets are super-admin only', () => {
    it.each(['VIEWER', 'CONTENT_MANAGER', 'LOCATION_MANAGER', 'COMPANY_ADMIN'])(
      'denies %s the invoice ledger',
      (role) => {
        expect(allows(role, 'invoices')).toBe(false);
      },
    );

    it.each(['VIEWER', 'COMPANY_ADMIN'])('denies %s the companies registry', (role) => {
      expect(allows(role, 'companies')).toBe(false);
    });

    it('allows SUPER_ADMIN both', () => {
      expect(allows('SUPER_ADMIN', 'invoices')).toBe(true);
      expect(allows('SUPER_ADMIN', 'companies')).toBe(true);
    });

    it('says super-admin is required', () => {
      expect(() => service.assertDatasetAccess(user('COMPANY_ADMIN'), 'invoices' as any)).toThrow(
        /super-admin/i,
      );
    });
  });

  describe('ordinary operational datasets stay available to report:read holders', () => {
    // Regression guard: the fix must not lock VIEWERs out of normal reporting.
    it.each(['proof-of-play', 'screen-health', 'alerts', 'screens', 'locations'])(
      'allows VIEWER to export %s',
      (dataset) => {
        expect(allows('VIEWER', dataset)).toBe(true);
      },
    );
  });
});
