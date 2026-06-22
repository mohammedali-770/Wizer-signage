import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ImportStatus,
  ImportType,
  Orientation,
  Prisma,
  ScreenUse,
  TagType,
  UserRole,
} from '@prisma/client';

import { resolvePagination } from '../../common/dto/pagination.dto';
import { parseCsv, parseXlsx, toCsv } from '../../common/reporting/tabular';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { CompaniesService } from '../companies/companies.service';
import { InvitationsService } from '../invitations/invitations.service';
import { LocationsService } from '../locations/locations.service';
import { ScreenGroupsService } from '../screen-groups/screen-groups.service';
import { ScreensService } from '../screens/screens.service';
import { TagsService } from '../tags/tags.service';
import type { ListImportsQueryDto } from './dto/import.dto';

interface ImportScope {
  companyId: string | null;
  isSuperAdmin: boolean;
}

type Row = Record<string, string>;

interface Importer {
  superAdminOnly: boolean;
  /** Template header columns (also the keys parsed from the uploaded file). */
  headers: string[];
  sample: string[];
  /** Synchronous, side-effect-free row validation (format / required / enum). */
  validate: (row: Row) => string[];
  /** Authoritative create (uniqueness, refs, plan limits live here). */
  commit: (scope: ImportScope, actor: AuthenticatedUser, row: Row) => Promise<void>;
}

const MAX_ROWS = 5_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Roles a tenant-scoped USER import may invite (never SUPER_ADMIN). */
const ALLOWED_IMPORT_ROLES: string[] = Object.values(UserRole).filter(
  (r) => r !== UserRole.SUPER_ADMIN,
);

/**
 * Bulk CSV/XLSX import (Phase 10). Upload → validate → preview → commit, reusing
 * the existing entity create services so the SAME uniqueness, reference, and
 * plan-limit rules apply. Tenant-safe: company-scoped imports take companyId
 * from the authenticated tenant (never from the file); only the Super Admin
 * COMPANY import mints fresh companies.
 */
@Injectable()
export class ImportService {
  private readonly importers: Record<ImportType, Importer>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly locations: LocationsService,
    private readonly screens: ScreensService,
    private readonly screenGroups: ScreenGroupsService,
    private readonly tags: TagsService,
    private readonly invitations: InvitationsService,
    private readonly companies: CompaniesService,
  ) {
    this.importers = this.buildImporters();
  }

  // --- Templates ---------------------------------------------------------

  template(type: ImportType): string {
    const importer = this.importer(type);
    return toCsv(importer.headers, [importer.sample]);
  }

  // --- Upload + validate -------------------------------------------------

  async upload(
    scope: ImportScope,
    actor: AuthenticatedUser,
    type: ImportType,
    file: Express.Multer.File,
  ) {
    const importer = this.importer(type);
    if (importer.superAdminOnly && !scope.isSuperAdmin)
      throw new ForbiddenException('Only Super Admins can run this import.');
    if (!importer.superAdminOnly && !scope.companyId)
      throw new ForbiddenException('A company context is required for this import.');
    if (!file?.buffer?.length) throw new BadRequestException('An upload file is required.');

    let matrix: string[][];
    try {
      matrix = await this.parse(file);
    } catch {
      throw new BadRequestException('Could not parse the file. Upload a valid CSV or XLSX.');
    }
    const headerCells = matrix[0];
    if (!headerCells) throw new BadRequestException('The file is empty.');
    const header = headerCells.map((h) => h.trim().toLowerCase());
    // The first template column is always the required key (name/email); a file
    // missing it is the wrong shape — fail clearly instead of flagging every row.
    const keyColumn = importer.headers[0];
    if (keyColumn && !header.includes(keyColumn)) {
      throw new BadRequestException(
        `File is missing the required "${keyColumn}" column. Download the ${type} template.`,
      );
    }
    const dataRows = matrix.slice(1).filter((r) => r.some((c) => c.trim() !== ''));
    if (dataRows.length === 0)
      throw new BadRequestException('The file has a header but no data rows.');
    if (dataRows.length > MAX_ROWS)
      throw new BadRequestException(`Too many rows (max ${MAX_ROWS}).`);

    const preview = dataRows.map((cells, idx) => {
      const row: Row = {};
      header.forEach((key, i) => (row[key] = (cells[i] ?? '').trim()));
      const errors = importer.validate(row);
      return { line: idx + 2, data: row, valid: errors.length === 0, errors };
    });
    const validRows = preview.filter((p) => p.valid).length;

    const job = await this.prisma.importJob.create({
      data: {
        companyId: importer.superAdminOnly ? null : scope.companyId,
        type,
        status: ImportStatus.VALIDATED,
        fileName: file.originalname ?? 'upload',
        totalRows: preview.length,
        validRows,
        invalidRows: preview.length - validRows,
        errors: preview
          .filter((p) => !p.valid)
          .map((p) => ({ line: p.line, errors: p.errors })) as unknown as Prisma.InputJsonValue,
        previewData: preview as unknown as Prisma.InputJsonValue,
        createdById: actor.userId,
      },
    });
    await this.log(actor, job.companyId, 'import.uploaded', job.id, {
      type,
      totalRows: preview.length,
      validRows,
    });
    return this.toView(job);
  }

  // --- Commit ------------------------------------------------------------

  async commit(scope: ImportScope, actor: AuthenticatedUser, id: string) {
    const job = await this.loadOwned(scope, id);
    if (job.status === ImportStatus.COMMITTED)
      throw new BadRequestException('This import was already committed.');
    if (job.status === ImportStatus.CANCELLED)
      throw new BadRequestException('This import was cancelled.');
    const importer = this.importer(job.type);

    const preview =
      (job.previewData as unknown as Array<{ line: number; data: Row; valid: boolean }>) ?? [];
    const commitScope: ImportScope = { companyId: job.companyId, isSuperAdmin: scope.isSuperAdmin };

    const errors: Array<{ line: number; errors: string[] }> = [];
    let committed = 0;
    for (const entry of preview) {
      if (!entry.valid) continue;
      try {
        await importer.commit(commitScope, actor, entry.data);
        committed++;
      } catch (e) {
        errors.push({ line: entry.line, errors: [e instanceof Error ? e.message : String(e)] });
      }
    }

    const status = committed > 0 ? ImportStatus.COMMITTED : ImportStatus.FAILED;
    const updated = await this.prisma.importJob.update({
      where: { id },
      data: {
        status,
        validRows: committed,
        invalidRows: job.totalRows - committed,
        errors: errors as unknown as Prisma.InputJsonValue,
        committedAt: new Date(),
      },
    });
    await this.log(
      actor,
      job.companyId,
      status === ImportStatus.COMMITTED ? 'import.committed' : 'import.failed',
      id,
      {
        committed,
        failed: errors.length,
      },
    );
    return { ...this.toView(updated), committed, failed: errors.length, rowErrors: errors };
  }

  async cancel(scope: ImportScope, actor: AuthenticatedUser, id: string) {
    const job = await this.loadOwned(scope, id);
    if (job.status === ImportStatus.COMMITTED)
      throw new BadRequestException('A committed import cannot be cancelled.');
    const updated = await this.prisma.importJob.update({
      where: { id },
      data: { status: ImportStatus.CANCELLED },
    });
    await this.log(actor, job.companyId, 'import.cancelled', id, {});
    return this.toView(updated);
  }

  // --- Read --------------------------------------------------------------

  async list(scope: ImportScope, query: ListImportsQueryDto) {
    const { skip, take, meta } = resolvePagination(query);
    const where: Prisma.ImportJobWhereInput = scope.isSuperAdmin
      ? {}
      : { companyId: scope.companyId };
    if (query.type) where.type = query.type;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.importJob.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.importJob.count({ where }),
    ]);
    return { items: rows.map((r) => this.toView(r)), meta: meta(total) };
  }

  async get(scope: ImportScope, id: string) {
    const job = await this.loadOwned(scope, id);
    return { ...this.toView(job), preview: job.previewData };
  }

  // --- Helpers -----------------------------------------------------------

  private importer(type: ImportType): Importer {
    const importer = this.importers[type];
    if (!importer) throw new BadRequestException(`Unsupported import type "${type}".`);
    return importer;
  }

  private async parse(file: Express.Multer.File): Promise<string[][]> {
    const name = (file.originalname ?? '').toLowerCase();
    if (name.endsWith('.xlsx')) return parseXlsx(file.buffer);
    return parseCsv(file.buffer.toString('utf-8'));
  }

  private async loadOwned(scope: ImportScope, id: string) {
    const job = await this.prisma.importJob.findFirst({
      where: { id, ...(scope.isSuperAdmin ? {} : { companyId: scope.companyId }) },
    });
    if (!job) throw new NotFoundException('Import job not found.');
    return job;
  }

  private async log(
    actor: AuthenticatedUser,
    companyId: string | null,
    action: string,
    id: string,
    metadata: Prisma.InputJsonValue,
  ) {
    await this.activityLog.log({
      action,
      category: 'IMPORT',
      actorId: actor.userId,
      companyId,
      targetType: 'import_job',
      targetId: id,
      metadata,
    });
  }

  private toView(j: Prisma.ImportJobGetPayload<true>) {
    return {
      id: j.id,
      companyId: j.companyId,
      type: j.type,
      status: j.status,
      fileName: j.fileName,
      totalRows: j.totalRows,
      validRows: j.validRows,
      invalidRows: j.invalidRows,
      errors: j.errors,
      committedAt: j.committedAt ? j.committedAt.toISOString() : null,
      createdAt: j.createdAt.toISOString(),
      updatedAt: j.updatedAt.toISOString(),
    };
  }

  // --- Importer registry -------------------------------------------------

  private buildImporters(): Record<ImportType, Importer> {
    const req = (row: Row, key: string, label: string) =>
      !row[key]?.trim() ? [`${label} is required.`] : [];
    const enumErr = (row: Row, key: string, values: string[], label: string) => {
      const v = row[key];
      return v && !values.includes(v.toUpperCase())
        ? [`${label} must be one of: ${values.join(', ')}.`]
        : [];
    };

    return {
      [ImportType.LOCATION]: {
        superAdminOnly: false,
        headers: ['name', 'code', 'city', 'region', 'country', 'timezone'],
        sample: ['Main Branch', 'MB-01', 'Riyadh', 'Riyadh', 'SA', 'Asia/Riyadh'],
        validate: (row) => [...req(row, 'name', 'name')],
        commit: async (scope, actor, row) => {
          await this.locations.create(scope.companyId!, actor, {
            name: row.name!,
            code: row.code || undefined,
            city: row.city || undefined,
            region: row.region || undefined,
            country: row.country || undefined,
            timezone: row.timezone || undefined,
          });
        },
      },
      [ImportType.SCREEN]: {
        superAdminOnly: false,
        headers: ['name', 'code', 'location', 'orientation', 'use'],
        sample: ['Lobby Display', 'SCR-01', 'MB-01', 'LANDSCAPE', 'GENERIC'],
        validate: (row) => [
          ...req(row, 'name', 'name'),
          ...enumErr(row, 'orientation', Object.values(Orientation), 'orientation'),
          ...enumErr(row, 'use', Object.values(ScreenUse), 'use'),
        ],
        commit: async (scope, actor, row) => {
          let locationId: string | undefined;
          if (row.location?.trim()) {
            const loc = await this.prisma.location.findFirst({
              where: {
                companyId: scope.companyId!,
                deletedAt: null,
                OR: [{ code: row.location }, { name: row.location }],
              },
              select: { id: true },
            });
            if (!loc) throw new BadRequestException(`Location "${row.location}" not found.`);
            locationId = loc.id;
          }
          await this.screens.create(scope.companyId!, actor, {
            name: row.name!,
            code: row.code || undefined,
            locationId,
            orientation: (row.orientation?.toUpperCase() as Orientation) || undefined,
            use: (row.use?.toUpperCase() as ScreenUse) || undefined,
          });
        },
      },
      [ImportType.SCREEN_GROUP]: {
        superAdminOnly: false,
        headers: ['name', 'description', 'category'],
        sample: ['North Region', 'All northern screens', 'region'],
        validate: (row) => [...req(row, 'name', 'name')],
        commit: async (scope, actor, row) => {
          await this.screenGroups.create(scope.companyId!, actor, {
            name: row.name!,
            description: row.description || undefined,
            category: row.category || undefined,
          });
        },
      },
      [ImportType.TAG]: {
        superAdminOnly: false,
        headers: ['name', 'type', 'color', 'description'],
        sample: ['Promotion', 'BOTH', '#2563eb', 'Promotional content'],
        validate: (row) => [
          ...req(row, 'name', 'name'),
          ...enumErr(row, 'type', Object.values(TagType), 'type'),
        ],
        commit: async (scope, actor, row) => {
          await this.tags.create(scope.companyId!, actor, {
            name: row.name!,
            type: (row.type?.toUpperCase() as TagType) || undefined,
            color: row.color || undefined,
            description: row.description || undefined,
          });
        },
      },
      [ImportType.USER]: {
        superAdminOnly: false,
        headers: ['email', 'name', 'role'],
        sample: ['manager@example.com', 'Jane Manager', 'LOCATION_MANAGER'],
        validate: (row) => {
          const errors = [...req(row, 'email', 'email'), ...req(row, 'role', 'role')];
          if (row.email && !EMAIL_RE.test(row.email)) errors.push('email is not a valid address.');
          const role = row.role?.toUpperCase() ?? '';
          if (role && !ALLOWED_IMPORT_ROLES.includes(role)) {
            errors.push(`role must be one of: ${ALLOWED_IMPORT_ROLES.join(', ')}.`);
          }
          return errors;
        },
        // companyId is resolved from the actor's tenant by InvitationsService;
        // upload() already guarantees a company context for this (non-Super-Admin)
        // import, so the invite can never land in another / no company.
        commit: async (_scope, actor, row) => {
          await this.invitations.create(actor, {
            email: row.email!.toLowerCase(),
            name: row.name || undefined,
            role: row.role!.toUpperCase() as Exclude<UserRole, 'SUPER_ADMIN'>,
          });
        },
      },
      [ImportType.COMPANY]: {
        superAdminOnly: true,
        headers: ['name', 'slug', 'timezone'],
        sample: ['Acme Retail', 'acme-retail', 'Asia/Riyadh'],
        validate: (row) => [...req(row, 'name', 'name')],
        commit: async (_scope, actor, row) => {
          await this.companies.create(actor, {
            name: row.name!,
            slug: row.slug || undefined,
            timezone: row.timezone || undefined,
          });
        },
      },
    };
  }
}
