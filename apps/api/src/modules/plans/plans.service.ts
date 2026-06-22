import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { resolvePagination } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityCategory, ActivityLogService } from '../activity-log/activity-log.service';
import type { CreatePlanDto, ListPlansQueryDto, UpdatePlanDto } from './dto/plan.dto';

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreatePlanDto) {
    const plan = await this.prisma.plan.create({
      data: {
        name: dto.name,
        code: dto.code,
        description: dto.description,
        priceMonthly: dto.price ?? 0,
        priceYearly: dto.priceYearly ?? null,
        currency: dto.currency ?? 'USD',
        billingInterval: dto.billingInterval ?? 'MONTHLY',
        trialDays: dto.trialDays ?? 0,
        isActive: dto.isActive ?? true,
        isPublic: dto.isPublic ?? true,
        limits: (dto.limits ?? {}) as Prisma.InputJsonValue,
      },
    });
    await this.activityLog.log({
      action: 'plan.created',
      category: ActivityCategory.PLAN,
      actorId: actor.userId,
      companyId: null,
      targetType: 'plan',
      targetId: plan.id,
      metadata: { code: plan.code, name: plan.name },
    });
    return plan;
  }

  async list(query: ListPlansQueryDto) {
    const { skip, take, meta } = resolvePagination(query);
    const where: Prisma.PlanWhereInput = {};
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { code: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.plan.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.plan.count({ where }),
    ]);
    return { items, meta: meta(total) };
  }

  async getByIdOrThrow(id: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Plan not found.');
    return plan;
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdatePlanDto) {
    await this.getByIdOrThrow(id);
    const data: Prisma.PlanUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.price !== undefined) data.priceMonthly = dto.price;
    if (dto.priceYearly !== undefined) data.priceYearly = dto.priceYearly;
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.billingInterval !== undefined) data.billingInterval = dto.billingInterval;
    if (dto.trialDays !== undefined) data.trialDays = dto.trialDays;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.isPublic !== undefined) data.isPublic = dto.isPublic;
    if (dto.limits !== undefined) data.limits = dto.limits as Prisma.InputJsonValue;

    const plan = await this.prisma.plan.update({ where: { id }, data });
    await this.activityLog.log({
      action: 'plan.updated',
      category: ActivityCategory.PLAN,
      actorId: actor.userId,
      companyId: null,
      targetType: 'plan',
      targetId: id,
      metadata: { changes: Object.keys(data) },
    });
    return plan;
  }

  /** Archive (deactivate) or re-activate a plan. */
  async setActive(actor: AuthenticatedUser, id: string, isActive: boolean) {
    await this.getByIdOrThrow(id);
    const plan = await this.prisma.plan.update({ where: { id }, data: { isActive } });
    await this.activityLog.log({
      action: isActive ? 'plan.activated' : 'plan.archived',
      category: ActivityCategory.PLAN,
      actorId: actor.userId,
      companyId: null,
      targetType: 'plan',
      targetId: id,
    });
    return plan;
  }
}
