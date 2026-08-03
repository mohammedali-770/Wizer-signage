import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { hasPermission, Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import {
  FORMAT_CONTENT_TYPE,
  FORMAT_EXTENSION,
  type Cell,
  toCsv,
  toPrintHtml,
  toXlsx,
} from '../../common/reporting/tabular';

export type ExportDataset =
  | 'proof-of-play'
  | 'screen-health'
  | 'alerts'
  | 'activity-logs'
  | 'screens'
  | 'locations'
  | 'companies'
  | 'invoices';

export type ExportFormat = 'CSV' | 'XLSX' | 'PDF';

/** Every dataset `GET /exports/:type` accepts. Single source of truth: the
 *  controller validates against it and the DTO builds its error message from it. */
export const DATASETS: ExportDataset[] = [
  'proof-of-play',
  'screen-health',
  'alerts',
  'activity-logs',
  'screens',
  'locations',
  'companies',
  'invoices',
];

export const FORMATS: ExportFormat[] = ['CSV', 'XLSX', 'PDF'];

export interface ExportScope {
  companyId: string | null;
  isSuperAdmin: boolean;
}

/**
 * Extra authority required PER DATASET, on top of the controller's blanket
 * `report:read`.
 *
 * The controller gates the whole `GET /exports/:type` surface on `report:read`,
 * which is in READ_ONLY and therefore held by VIEWER. That collapsed four very
 * different permission boundaries into one: the interactive routes require
 * `activity:read` (COMPANY_ADMIN) for the audit trail and SUPER_ADMIN for
 * billing, but the export of the SAME data required neither — so a VIEWER or a
 * contractor with CONTENT_MANAGER could pull the tenant's full audit trail and
 * invoice ledger as a spreadsheet.
 *
 * Datasets absent from this map need only `report:read`.
 */
const DATASET_PERMISSIONS: Partial<Record<ExportDataset, Permission>> = {
  // Mirrors ActivityLogController — the audit trail names actors, targets and
  // change payloads for every login, password change and user mutation.
  'activity-logs': Permission.ActivityRead,
};

/** Datasets that are platform-level and require SUPER_ADMIN, never a tenant role. */
const SUPER_ADMIN_DATASETS: ReadonlySet<ExportDataset> = new Set<ExportDataset>([
  // Mirrors InvoicesController (@Roles(SUPER_ADMIN)) and the companies registry.
  'invoices',
  'companies',
]);

export interface ExportFilters {
  from?: string;
  to?: string;
  screenId?: string;
  status?: string;
}

export interface Dataset {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: Cell[][];
}

/** Maps a scheduled ReportType to an export dataset. */
export const REPORT_TYPE_DATASET: Record<string, ExportDataset> = {
  PROOF_OF_PLAY: 'proof-of-play',
  SCREEN_HEALTH: 'screen-health',
  ALERTS: 'alerts',
  ACTIVITY_LOGS: 'activity-logs',
  BILLING: 'invoices',
};

const ROW_CAP = 50_000;

/**
 * Read-only, tenant-scoped reporting layer (Phase 10). Builds a tabular dataset
 * for an entity and renders it as CSV / XLSX / print-HTML(PDF). Never exposes
 * cross-company data; the `companies` dataset is Super Admin only.
 */
@Injectable()
export class ExportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Assert the caller may export THIS dataset, not merely "some report".
   *
   * Takes the full authenticated user (not the reduced {companyId,isSuperAdmin}
   * scope) because the decision needs the caller's role. Call this before any
   * dataset is built — including from the scheduled-report runner, so a report
   * cannot be scheduled by a role that could not read the data interactively.
   */
  assertDatasetAccess(user: AuthenticatedUser, dataset: ExportDataset): void {
    if (SUPER_ADMIN_DATASETS.has(dataset)) {
      if (!user.isSuperAdmin) {
        throw new ForbiddenException(`Exporting "${dataset}" requires super-admin access.`);
      }
      return;
    }
    const required = DATASET_PERMISSIONS[dataset];
    if (required && !hasPermission(user.role, required)) {
      throw new ForbiddenException(`Exporting "${dataset}" requires the "${required}" permission.`);
    }
  }

  async dataset(
    scope: ExportScope,
    dataset: ExportDataset,
    filters: ExportFilters = {},
  ): Promise<Dataset> {
    switch (dataset) {
      case 'proof-of-play':
        return this.proofOfPlay(scope, filters);
      case 'screen-health':
        return this.screenHealth(scope);
      case 'alerts':
        return this.alerts(scope, filters);
      case 'activity-logs':
        return this.activityLogs(scope, filters);
      case 'screens':
        return this.screens(scope);
      case 'locations':
        return this.locations(scope);
      case 'invoices':
        return this.invoices(scope);
      case 'companies':
        return this.companies(scope);
      default:
        throw new ForbiddenException('Unknown export dataset.');
    }
  }

  async render(
    dataset: Dataset,
    format: ExportFormat,
    baseName: string,
    now: Date = new Date(),
  ): Promise<{ contentType: string; filename: string; body: string | Buffer }> {
    const stamp = now.toISOString().slice(0, 10);
    const filename = `${baseName}-${stamp}.${FORMAT_EXTENSION[format] ?? 'csv'}`;
    const contentType = FORMAT_CONTENT_TYPE[format] ?? 'text/csv; charset=utf-8';
    let body: string | Buffer;
    if (format === 'XLSX') {
      body = await toXlsx(dataset.title, dataset.headers, dataset.rows);
    } else if (format === 'PDF') {
      body = toPrintHtml(dataset.title, dataset.headers, dataset.rows, dataset.subtitle);
    } else {
      body = toCsv(dataset.headers, dataset.rows);
    }
    return { contentType, filename, body };
  }

  // --- Dataset builders ---------------------------------------------------

  private companyWhere(scope: ExportScope): { companyId: string } {
    if (!scope.companyId)
      throw new ForbiddenException('A company context is required for this export.');
    return { companyId: scope.companyId };
  }

  private dateRange(filters: ExportFilters): Prisma.DateTimeFilter | undefined {
    if (!filters.from && !filters.to) return undefined;
    const range: Prisma.DateTimeFilter = {};
    if (filters.from) range.gte = new Date(filters.from);
    if (filters.to) range.lte = new Date(filters.to);
    return range;
  }

  private async proofOfPlay(scope: ExportScope, filters: ExportFilters): Promise<Dataset> {
    const where: Prisma.ProofOfPlayWhereInput = { ...this.companyWhere(scope) };
    const range = this.dateRange(filters);
    if (range) where.startedAt = range;
    if (filters.screenId) where.screenId = filters.screenId;
    if (filters.status) where.status = filters.status as Prisma.ProofOfPlayWhereInput['status'];
    const rows = await this.prisma.proofOfPlay.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: ROW_CAP,
      include: { screen: { select: { name: true } } },
    });
    return {
      title: 'Proof of Play',
      headers: [
        'startedAt',
        'endedAt',
        'screen',
        'contentId',
        'sourceType',
        'playbackSource',
        'status',
        'durationMs',
        'offline',
      ],
      rows: rows.map((r) => [
        r.startedAt.toISOString(),
        r.endedAt?.toISOString() ?? '',
        r.screen?.name ?? r.screenId,
        r.contentId ?? '',
        r.sourceType,
        r.playbackSource,
        r.status,
        r.durationMs ?? '',
        r.offlinePlayback ? 'offline' : 'online',
      ]),
    };
  }

  private async screenHealth(scope: ExportScope): Promise<Dataset> {
    const rows = await this.prisma.screen.findMany({
      where: { ...this.companyWhere(scope), deletedAt: null },
      orderBy: { name: 'asc' },
      // Bounded like every other dataset: an export must not stream a whole
      // tenant's fleet into memory and then render it.
      take: ROW_CAP,
      include: {
        location: { select: { name: true } },
        device: {
          select: {
            playbackState: true,
            syncStatus: true,
            appVersion: true,
            lastHeartbeatAt: true,
            networkStatus: true,
          },
        },
      },
    });
    return {
      title: 'Screen Health',
      headers: [
        'screen',
        'location',
        'status',
        'lastHeartbeatAt',
        'playbackState',
        'syncStatus',
        'network',
        'appVersion',
      ],
      rows: rows.map((s) => [
        s.name,
        s.location?.name ?? '',
        s.status,
        s.lastHeartbeatAt?.toISOString() ?? '',
        s.device?.playbackState ?? '',
        s.device?.syncStatus ?? '',
        s.device?.networkStatus ?? '',
        s.device?.appVersion ?? '',
      ]),
    };
  }

  private async alerts(scope: ExportScope, filters: ExportFilters): Promise<Dataset> {
    const where: Prisma.AlertWhereInput = {
      companyId: scope.isSuperAdmin ? null : scope.companyId,
    };
    const range = this.dateRange(filters);
    if (range) where.triggeredAt = range;
    if (filters.status) where.status = filters.status as Prisma.AlertWhereInput['status'];
    const rows = await this.prisma.alert.findMany({
      where,
      orderBy: { triggeredAt: 'desc' },
      take: ROW_CAP,
    });
    return {
      title: 'Alerts',
      headers: [
        'triggeredAt',
        'severity',
        'status',
        'type',
        'title',
        'message',
        'screenId',
        'resolvedAt',
      ],
      rows: rows.map((a) => [
        a.triggeredAt.toISOString(),
        a.severity,
        a.status,
        a.type,
        a.title,
        a.message ?? '',
        a.screenId ?? '',
        a.resolvedAt?.toISOString() ?? '',
      ]),
    };
  }

  private async activityLogs(scope: ExportScope, filters: ExportFilters): Promise<Dataset> {
    const where: Prisma.ActivityLogWhereInput = scope.isSuperAdmin
      ? {}
      : { companyId: scope.companyId };
    const range = this.dateRange(filters);
    if (range) where.createdAt = range;
    const rows = await this.prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: ROW_CAP,
    });
    return {
      title: 'Activity Logs',
      headers: [
        'createdAt',
        'category',
        'action',
        'actorId',
        'targetType',
        'targetId',
        'description',
      ],
      rows: rows.map((l) => [
        l.createdAt.toISOString(),
        l.category,
        l.action,
        l.actorId ?? '',
        l.targetType ?? '',
        l.targetId ?? '',
        l.description ?? '',
      ]),
    };
  }

  private async screens(scope: ExportScope): Promise<Dataset> {
    const rows = await this.prisma.screen.findMany({
      where: { ...this.companyWhere(scope), deletedAt: null },
      orderBy: { name: 'asc' },
      take: ROW_CAP,
      include: { location: { select: { name: true } } },
    });
    return {
      title: 'Screens',
      headers: ['name', 'code', 'location', 'status', 'orientation', 'use', 'lastHeartbeatAt'],
      rows: rows.map((s) => [
        s.name,
        s.code ?? '',
        s.location?.name ?? '',
        s.status,
        s.orientation,
        s.use,
        s.lastHeartbeatAt?.toISOString() ?? '',
      ]),
    };
  }

  private async locations(scope: ExportScope): Promise<Dataset> {
    const rows = await this.prisma.location.findMany({
      where: { ...this.companyWhere(scope), deletedAt: null },
      orderBy: { name: 'asc' },
      take: ROW_CAP,
    });
    return {
      title: 'Locations',
      headers: ['name', 'code', 'city', 'region', 'country', 'status', 'timezone'],
      rows: rows.map((l) => [
        l.name,
        l.code ?? '',
        l.city ?? '',
        l.region ?? '',
        l.country ?? '',
        l.status,
        l.timezone ?? '',
      ]),
    };
  }

  private async companies(scope: ExportScope): Promise<Dataset> {
    if (!scope.isSuperAdmin)
      throw new ForbiddenException('Only Super Admins can export companies.');
    const rows = await this.prisma.company.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      take: ROW_CAP,
    });
    return {
      title: 'Companies',
      headers: ['name', 'slug', 'status', 'timezone', 'createdAt'],
      rows: rows.map((c) => [c.name, c.slug, c.status, c.timezone, c.createdAt.toISOString()]),
    };
  }

  private async invoices(scope: ExportScope): Promise<Dataset> {
    // Invoices are financial records — exported, never deleted by retention.
    const where: Prisma.InvoiceWhereInput = scope.isSuperAdmin ? {} : this.companyWhere(scope);
    const rows = await this.prisma.invoice.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: ROW_CAP,
    });
    return {
      title: 'Invoices',
      headers: [
        'number',
        'status',
        'currency',
        'subtotal',
        'tax',
        'total',
        'issuedAt',
        'dueAt',
        'paidAt',
      ],
      rows: rows.map((i) => [
        i.number,
        i.status,
        i.currency,
        i.subtotal.toString(),
        i.tax?.toString() ?? '',
        i.total.toString(),
        i.issuedAt?.toISOString() ?? '',
        i.dueAt?.toISOString() ?? '',
        i.paidAt?.toISOString() ?? '',
      ]),
    };
  }
}
