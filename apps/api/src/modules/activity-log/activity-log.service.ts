import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { DEFAULT_PAGE_SIZE } from '@master-signage/shared';

import { TenantContextService } from '../../common/context/tenant-context.service';
import { PrismaService } from '../../prisma/prisma.service';

/** Stable activity categories. */
export const ActivityCategory = {
  AUTH: 'AUTH',
  SECURITY: 'SECURITY',
  USER: 'USER',
  COMPANY: 'COMPANY',
  SESSION: 'SESSION',
  INVITATION: 'INVITATION',
  TWO_FACTOR: 'TWO_FACTOR',
  PLAN: 'PLAN',
  SUBSCRIPTION: 'SUBSCRIPTION',
  INVOICE: 'INVOICE',
  BILLING: 'BILLING',
  USAGE: 'USAGE',
} as const;

export interface ActivityLogInput {
  action: string;
  category: string;
  /** When omitted, taken from the request-scoped tenant context. */
  companyId?: string | null;
  actorId?: string | null;
  targetType?: string;
  targetId?: string;
  description?: string;
  metadata?: Prisma.InputJsonValue;
  ip?: string;
  userAgent?: string;
}

export interface ActivityLogQuery {
  companyId: string | null;
  isSuperAdmin: boolean;
  page?: number;
  pageSize?: number;
  action?: string;
  category?: string;
  actorId?: string;
  from?: Date;
  to?: Date;
}

/**
 * Writes and reads the audit trail. `log()` is best-effort: a logging failure
 * must never break the originating request.
 */
@Injectable()
export class ActivityLogService {
  private readonly logger = new Logger(ActivityLogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async log(input: ActivityLogInput): Promise<void> {
    try {
      const store = this.tenantContext.store;
      await this.prisma.activityLog.create({
        data: {
          companyId: input.companyId !== undefined ? input.companyId : (store?.companyId ?? null),
          actorId: input.actorId !== undefined ? input.actorId : (store?.userId ?? null),
          action: input.action,
          category: input.category,
          targetType: input.targetType,
          targetId: input.targetId,
          description: input.description,
          metadata: input.metadata ?? {},
          ip: input.ip ?? store?.ip,
          userAgent: input.userAgent ?? store?.userAgent,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to write activity log (${input.category}/${input.action}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async query(params: ActivityLogQuery) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? DEFAULT_PAGE_SIZE));

    const where: Prisma.ActivityLogWhereInput = {};
    // Tenant isolation: non–super-admins only ever see their own company's logs.
    if (!params.isSuperAdmin) {
      where.companyId = params.companyId;
    } else if (params.companyId) {
      where.companyId = params.companyId;
    }

    if (params.action) where.action = params.action;
    if (params.category) where.category = params.category;
    if (params.actorId) where.actorId = params.actorId;
    if (params.from || params.to) {
      where.createdAt = {};
      if (params.from) where.createdAt.gte = params.from;
      if (params.to) where.createdAt.lte = params.to;
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.activityLog.count({ where }),
    ]);

    return {
      items,
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }
}
