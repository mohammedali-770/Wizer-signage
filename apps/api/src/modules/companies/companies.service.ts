import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Company, CompanyStatus, Prisma, SubscriptionStatus } from '@prisma/client';

import { resolvePagination } from '../../common/dto/pagination.dto';
import { PasswordService } from '../../common/crypto/password.service';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityCategory, ActivityLogService } from '../activity-log/activity-log.service';
import { SessionsService } from '../sessions/sessions.service';
import { UsageLimitsService } from '../usage-limits/usage-limits.service';
import type { CreateCompanyDto, ListCompaniesQueryDto, UpdateCompanyDto } from './dto/company.dto';

/** Public-safe view of a company (omits operational secrets). */
export type CompanyView = Omit<Company, 'defaultKioskPinHash'>;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly sessions: SessionsService,
    private readonly usageLimits: UsageLimitsService,
    private readonly password: PasswordService,
  ) {}

  // --- Phase 1 helpers (reused) ------------------------------------------

  findById(id: string): Promise<Company | null> {
    return this.prisma.company.findFirst({ where: { id, deletedAt: null } });
  }

  async getByIdOrThrow(id: string): Promise<Company> {
    const company = await this.findById(id);
    if (!company) throw new NotFoundException('Company not found.');
    return company;
  }

  async getForPrincipal(companyId: string | null): Promise<CompanyView> {
    if (!companyId) {
      throw new NotFoundException('No company is associated with this account.');
    }
    return this.toView(await this.getByIdOrThrow(companyId));
  }

  isSuspended(company: Pick<Company, 'status'>): boolean {
    return company.status === 'SUSPENDED' || company.status === 'CANCELLED';
  }

  toView(company: Company): CompanyView {
    const { defaultKioskPinHash: _omit, ...view } = company;
    return view;
  }

  // --- Super Admin management --------------------------------------------

  async create(actor: AuthenticatedUser, dto: CreateCompanyDto) {
    const slug = await this.uniqueSlug(dto.slug ?? (slugify(dto.name) || 'company'));

    let subscriptionCreate: Prisma.SubscriptionCreateNestedOneWithoutCompanyInput | undefined;
    if (dto.planId) {
      const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
      if (!plan) throw new NotFoundException('Plan not found.');
      subscriptionCreate = {
        create: {
          planId: plan.id,
          status: SubscriptionStatus.TRIALING,
          trialEndsAt:
            plan.trialDays > 0 ? new Date(Date.now() + plan.trialDays * 86_400_000) : null,
          currentPeriodStart: new Date(),
        },
      };
    }

    const company = await this.prisma.company.create({
      data: {
        name: dto.name,
        slug,
        defaultLocale: dto.defaultLocale ?? 'en',
        timezone: dto.timezone ?? 'UTC',
        logoUrl: dto.logoUrl,
        primaryColor: dto.primaryColor,
        defaultKioskPinHash: dto.defaultKioskPin
          ? await this.password.hash(dto.defaultKioskPin)
          : null,
        ...(subscriptionCreate ? { subscription: subscriptionCreate } : {}),
      },
    });

    await this.activityLog.log({
      action: 'company.created',
      category: ActivityCategory.COMPANY,
      actorId: actor.userId,
      companyId: company.id,
      targetType: 'company',
      targetId: company.id,
      metadata: { name: company.name, slug: company.slug, planId: dto.planId ?? null },
    });
    return this.toView(company);
  }

  async list(query: ListCompaniesQueryDto) {
    const { skip, take, meta } = resolvePagination(query);
    const where: Prisma.CompanyWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { slug: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const orderBy: Prisma.CompanyOrderByWithRelationInput = {
      [query.sort ?? 'createdAt']: query.order ?? 'desc',
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.company.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          subscription: { include: { plan: { select: { name: true, code: true } } } },
          _count: { select: { users: true, locations: true, screens: true } },
        },
      }),
      this.prisma.company.count({ where }),
    ]);

    const items = rows.map(({ defaultKioskPinHash: _omit, ...company }) => ({
      ...company,
      metrics: {
        users: company._count.users,
        locations: company._count.locations,
        screens: company._count.screens,
      },
    }));
    return { items, meta: meta(total) };
  }

  /** Company detail with metrics (usage), subscription, and plan. */
  async getDetail(id: string) {
    const company = await this.prisma.company.findFirst({
      where: { id, deletedAt: null },
      include: { subscription: { include: { plan: true } } },
    });
    if (!company) throw new NotFoundException('Company not found.');

    const usage = await this.usageLimits.evaluate(id);
    const { defaultKioskPinHash: _omit, subscription, ...companyView } = company;
    return { company: companyView, subscription, usage };
  }

  async getUsage(id: string) {
    await this.getByIdOrThrow(id);
    return this.usageLimits.evaluate(id);
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateCompanyDto) {
    await this.getByIdOrThrow(id);
    const data: Prisma.CompanyUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.defaultLocale !== undefined) data.defaultLocale = dto.defaultLocale;
    if (dto.timezone !== undefined) data.timezone = dto.timezone;
    if (dto.logoUrl !== undefined) data.logoUrl = dto.logoUrl;
    if (dto.primaryColor !== undefined) data.primaryColor = dto.primaryColor;
    if (dto.brandedEmailFrom !== undefined) data.brandedEmailFrom = dto.brandedEmailFrom;
    if (dto.customDomain !== undefined) data.customDomain = dto.customDomain;
    if (dto.defaultKioskPin !== undefined) {
      data.defaultKioskPinHash = dto.defaultKioskPin
        ? await this.password.hash(dto.defaultKioskPin)
        : null;
    }

    const company = await this.prisma.company.update({ where: { id }, data });
    await this.activityLog.log({
      action: 'company.updated',
      category: ActivityCategory.COMPANY,
      actorId: actor.userId,
      companyId: id,
      targetType: 'company',
      targetId: id,
      metadata: { changes: Object.keys(data) },
    });
    return this.toView(company);
  }

  async suspend(actor: AuthenticatedUser, id: string, reason?: string) {
    const company = await this.getByIdOrThrow(id);
    // Reject any already-blocked state (SUSPENDED or terminal CANCELLED) so a
    // cancelled company cannot be re-suspended and then reactivated.
    if (this.isSuspended(company)) {
      throw new BadRequestException('Company is already suspended or cancelled.');
    }
    const updated = await this.prisma.company.update({
      where: { id },
      data: {
        status: CompanyStatus.SUSPENDED,
        suspendedAt: new Date(),
        suspendedReason: reason ?? null,
      },
    });
    // Force all of the company's users out of the dashboard immediately.
    const revoked = await this.sessions.revokeAllForCompany(id, 'company_suspended');

    await this.activityLog.log({
      action: 'company.suspended',
      category: ActivityCategory.COMPANY,
      actorId: actor.userId,
      companyId: id,
      targetType: 'company',
      targetId: id,
      metadata: { reason: reason ?? null, revokedSessions: revoked },
    });
    return this.toView(updated);
  }

  async reactivate(actor: AuthenticatedUser, id: string) {
    const company = await this.getByIdOrThrow(id);
    if (company.status !== CompanyStatus.SUSPENDED) {
      throw new BadRequestException('Company is not suspended.');
    }
    const updated = await this.prisma.company.update({
      where: { id },
      data: { status: CompanyStatus.ACTIVE, suspendedAt: null, suspendedReason: null },
    });
    await this.activityLog.log({
      action: 'company.reactivated',
      category: ActivityCategory.COMPANY,
      actorId: actor.userId,
      companyId: id,
      targetType: 'company',
      targetId: id,
    });
    return this.toView(updated);
  }

  private async uniqueSlug(base: string): Promise<string> {
    const root = base || 'company';
    let slug = root;
    let n = 1;
    // eslint-disable-next-line no-await-in-loop
    while (await this.prisma.company.findUnique({ where: { slug } })) {
      n += 1;
      slug = `${root}-${n}`;
    }
    return slug;
  }
}
