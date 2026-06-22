import { BadRequestException, Injectable } from '@nestjs/common';
import { CompanyStatus, SubscriptionStatus, UserRole, UserStatus } from '@prisma/client';

import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityCategory, ActivityLogService } from '../activity-log/activity-log.service';
import { InvitationsService } from '../invitations/invitations.service';
import { UsersService } from '../users/users.service';
import type { InviteSuperAdminDto, ListSuperAdminsQueryDto } from './dto/super-admin.dto';

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
    const [
      companyGroups,
      subscriptionGroups,
      activePlans,
      unpaidInvoices,
      totalUsers,
      activeSuperAdmins,
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
        unpaidTotal: Number(unpaidInvoices._sum.total ?? 0),
      },
      users: { total: totalUsers },
      superAdmins: { active: activeSuperAdmins },
    };
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
