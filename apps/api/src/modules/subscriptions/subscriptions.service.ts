import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SubscriptionStatus } from '@prisma/client';

import { resolvePagination } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityCategory, ActivityLogService } from '../activity-log/activity-log.service';
import { UsageLimitsService } from '../usage-limits/usage-limits.service';
import type {
  CreateSubscriptionDto,
  ListSubscriptionsQueryDto,
  UpdateSubscriptionDto,
} from './dto/subscription.dto';

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly usageLimits: UsageLimitsService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateSubscriptionDto) {
    const company = await this.prisma.company.findFirst({
      where: { id: dto.companyId, deletedAt: null },
    });
    if (!company) throw new NotFoundException('Company not found.');

    const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
    if (!plan) throw new NotFoundException('Plan not found.');

    const existing = await this.prisma.subscription.findUnique({
      where: { companyId: dto.companyId },
    });
    if (existing) {
      throw new ConflictException('Company already has a subscription. Update it instead.');
    }

    const status = dto.status ?? SubscriptionStatus.TRIALING;
    const trialEndsAt =
      status === SubscriptionStatus.TRIALING && (dto.trialDays ?? plan.trialDays) > 0
        ? new Date(Date.now() + (dto.trialDays ?? plan.trialDays) * 86_400_000)
        : null;

    const subscription = await this.prisma.subscription.create({
      data: {
        companyId: dto.companyId,
        planId: dto.planId,
        status,
        trialEndsAt,
        currentPeriodStart: dto.currentPeriodStart ? new Date(dto.currentPeriodStart) : new Date(),
        currentPeriodEnd: dto.currentPeriodEnd ? new Date(dto.currentPeriodEnd) : null,
      },
      include: { plan: true },
    });

    await this.activityLog.log({
      action: 'subscription.created',
      category: ActivityCategory.SUBSCRIPTION,
      actorId: actor.userId,
      companyId: dto.companyId,
      targetType: 'subscription',
      targetId: subscription.id,
      metadata: { planCode: plan.code, status },
    });
    return subscription;
  }

  async list(query: ListSubscriptionsQueryDto) {
    const { skip, take, meta } = resolvePagination(query);
    const where: Prisma.SubscriptionWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.companyId) where.companyId = query.companyId;
    if (query.search) {
      where.company = { name: { contains: query.search, mode: 'insensitive' } };
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.subscription.findMany({
        where,
        include: {
          plan: true,
          company: { select: { id: true, name: true, slug: true, status: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.subscription.count({ where }),
    ]);
    return { items, meta: meta(total) };
  }

  async getByIdOrThrow(id: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
      include: {
        plan: true,
        company: { select: { id: true, name: true, slug: true, status: true } },
      },
    });
    if (!subscription) throw new NotFoundException('Subscription not found.');
    return subscription;
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateSubscriptionDto) {
    const existing = await this.getByIdOrThrow(id);

    const data: Prisma.SubscriptionUpdateInput = {};
    const events: string[] = [];

    if (dto.planId !== undefined && dto.planId !== existing.planId) {
      const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
      if (!plan) throw new NotFoundException('Plan not found.');
      data.plan = { connect: { id: dto.planId } };
      events.push('plan_changed');
    }
    if (dto.status !== undefined && dto.status !== existing.status) {
      data.status = dto.status;
      events.push('status_changed');
    }
    if (dto.trialEndsAt !== undefined) data.trialEndsAt = new Date(dto.trialEndsAt);
    if (dto.currentPeriodStart !== undefined)
      data.currentPeriodStart = new Date(dto.currentPeriodStart);
    if (dto.currentPeriodEnd !== undefined) data.currentPeriodEnd = new Date(dto.currentPeriodEnd);
    if (dto.cancelAtPeriodEnd !== undefined) data.cancelAtPeriodEnd = dto.cancelAtPeriodEnd;

    const subscription = await this.prisma.subscription.update({
      where: { id },
      data,
      include: {
        plan: true,
        company: { select: { id: true, name: true, slug: true, status: true } },
      },
    });

    await this.activityLog.log({
      action: 'subscription.updated',
      category: ActivityCategory.SUBSCRIPTION,
      actorId: actor.userId,
      companyId: existing.companyId,
      targetType: 'subscription',
      targetId: id,
      metadata: { events, status: subscription.status, planCode: subscription.plan.code },
    });

    // A plan change may bring usage back within limits — clear any grace period.
    if (events.includes('plan_changed')) {
      await this.usageLimits.reconcileGrace(existing.companyId);
    }
    return subscription;
  }

  async cancel(actor: AuthenticatedUser, id: string) {
    const existing = await this.getByIdOrThrow(id);
    if (existing.status === SubscriptionStatus.CANCELLED) {
      throw new BadRequestException('Subscription is already cancelled.');
    }
    const subscription = await this.prisma.subscription.update({
      where: { id },
      data: { status: SubscriptionStatus.CANCELLED, canceledAt: new Date() },
      include: {
        plan: true,
        company: { select: { id: true, name: true, slug: true, status: true } },
      },
    });
    await this.activityLog.log({
      action: 'subscription.cancelled',
      category: ActivityCategory.SUBSCRIPTION,
      actorId: actor.userId,
      companyId: existing.companyId,
      targetType: 'subscription',
      targetId: id,
    });
    return subscription;
  }

  /** Subscription change history for a company (from the audit trail). */
  async history(companyId: string) {
    return this.prisma.activityLog.findMany({
      where: { companyId, category: ActivityCategory.SUBSCRIPTION },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
