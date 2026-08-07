import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CompanyStatus,
  DemoRequestStatus,
  SubscriptionStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';

import { resolvePagination } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityCategory, ActivityLogService } from '../activity-log/activity-log.service';
import { InvitationsService } from '../invitations/invitations.service';
import { UsersService } from '../users/users.service';
import type {
  InviteSuperAdminDto,
  ListDemoRequestsQueryDto,
  ListSuperAdminsQueryDto,
  UpdateDemoRequestDto,
} from './dto/super-admin.dto';

@Injectable()
export class SuperAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly invitations: InvitationsService,
    private readonly activityLog: ActivityLogService,
  ) {}

  /** Platform-wide overview counters for the Super Admin dashboard. */
  async getOverview() {
    // Read-only counters — Promise.all preserves Prisma's precise groupBy types
    // (which $transaction's tuple inference would widen).
    const now = new Date();
    const [
      companyGroups,
      subscriptionGroups,
      activePlans,
      unpaidInvoices,
      totalUsers,
      activeSuperAdmins,
      activeTrials,
      expiredTrials,
      paidTenants,
      demoTotal,
      demoNew,
      recentCompanies,
    ] = await Promise.all([
      this.prisma.company.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
        orderBy: { status: 'asc' },
      }),
      this.prisma.subscription.groupBy({
        by: ['status'],
        _count: { _all: true },
        orderBy: { status: 'asc' },
      }),
      this.prisma.plan.count({ where: { isActive: true } }),
      this.prisma.invoice.aggregate({
        where: { status: 'UNPAID' },
        _count: { _all: true },
        _sum: { total: true },
      }),
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.count({
        where: { role: UserRole.SUPER_ADMIN, status: UserStatus.ACTIVE, deletedAt: null },
      }),
      // Active trial = still TRIALING and not past its end date.
      this.prisma.subscription.count({
        where: { status: SubscriptionStatus.TRIALING, trialEndsAt: { gt: now } },
      }),
      // Expired trial = EXPIRED, or TRIALING but past its end date (job not yet run).
      this.prisma.subscription.count({
        where: {
          OR: [
            { status: SubscriptionStatus.EXPIRED },
            { status: SubscriptionStatus.TRIALING, trialEndsAt: { lte: now } },
          ],
        },
      }),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.ACTIVE } }),
      this.prisma.demoRequest.count(),
      this.prisma.demoRequest.count({ where: { status: DemoRequestStatus.NEW } }),
      this.prisma.company.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          createdAt: true,
          subscription: {
            select: {
              status: true,
              trialEndsAt: true,
              plan: { select: { name: true, code: true } },
            },
          },
        },
      }),
    ]);

    const companiesByStatus = toStatusMap(companyGroups, Object.values(CompanyStatus));
    const subscriptionsByStatus = toStatusMap(
      subscriptionGroups,
      Object.values(SubscriptionStatus),
    );

    return {
      companies: {
        total: sumCounts(companyGroups),
        byStatus: companiesByStatus,
      },
      subscriptions: {
        total: sumCounts(subscriptionGroups),
        byStatus: subscriptionsByStatus,
      },
      plans: { active: activePlans },
      invoices: {
        unpaid: unpaidInvoices._count._all,
        // A string, like the per-invoice `total` it sums. Number() here made the
        // aggregate the one money value in the API that was a JSON number.
        unpaidTotal: (unpaidInvoices._sum.total ?? 0).toString(),
      },
      users: { total: totalUsers },
      superAdmins: { active: activeSuperAdmins },
      trials: { active: activeTrials, expired: expiredTrials },
      paidTenants,
      demoRequests: { total: demoTotal, new: demoNew },
      recent: recentCompanies,
    };
  }

  /** Paginated demo-request leads from the marketing site. */
  async listDemoRequests(query: ListDemoRequestsQueryDto) {
    const { skip, take, meta } = resolvePagination(query);
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { email: { contains: query.search, mode: 'insensitive' } },
        { name: { contains: query.search, mode: 'insensitive' } },
        { companyName: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.demoRequest.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.demoRequest.count({ where }),
    ]);
    return { items, meta: meta(total) };
  }

  async updateDemoRequestStatus(actor: AuthenticatedUser, id: string, dto: UpdateDemoRequestDto) {
    const existing = await this.prisma.demoRequest.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException('Demo request not found.');
    const updated = await this.prisma.demoRequest.update({
      where: { id },
      data: { status: dto.status },
    });
    await this.activityLog.log({
      action: 'demo_request.updated',
      category: ActivityCategory.SECURITY,
      actorId: actor.userId,
      companyId: null,
      targetType: 'demo_request',
      targetId: id,
      metadata: { status: dto.status },
    });
    return updated;
  }

  listSuperAdmins(actor: AuthenticatedUser, query: ListSuperAdminsQueryDto) {
    return this.users.list(actor, {
      role: UserRole.SUPER_ADMIN,
      search: query.search,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  async invite(actor: AuthenticatedUser, dto: InviteSuperAdminDto) {
    const invitation = await this.invitations.create(actor, {
      email: dto.email,
      role: UserRole.SUPER_ADMIN,
      name: dto.name,
    });
    await this.activityLog.log({
      action: 'super_admin.invited',
      category: ActivityCategory.SECURITY,
      actorId: actor.userId,
      companyId: null,
      targetType: 'invitation',
      targetId: invitation.id,
      metadata: { email: dto.email },
    });
    return invitation;
  }

  async setStatus(actor: AuthenticatedUser, id: string, active: boolean) {
    const target = await this.users.getScopedOrThrow(actor, id);
    if (target.role !== UserRole.SUPER_ADMIN) {
      throw new BadRequestException('This account is not a Super Admin.');
    }
    // setStatus enforces last-active-Super-Admin protection + session revocation.
    const result = await this.users.setStatus(
      actor,
      id,
      active ? UserStatus.ACTIVE : UserStatus.DISABLED,
    );
    await this.activityLog.log({
      action: active ? 'super_admin.activated' : 'super_admin.deactivated',
      category: ActivityCategory.SECURITY,
      actorId: actor.userId,
      companyId: null,
      targetType: 'user',
      targetId: id,
    });
    return result;
  }
}

function sumCounts(groups: Array<{ _count: { _all: number } }>): number {
  return groups.reduce((sum, g) => sum + g._count._all, 0);
}

function toStatusMap<T extends string>(
  groups: Array<{ status: T; _count: { _all: number } }>,
  allStatuses: T[],
): Record<T, number> {
  const map = Object.fromEntries(allStatuses.map((s) => [s, 0])) as Record<T, number>;
  for (const g of groups) map[g.status] = g._count._all;
  return map;
}
