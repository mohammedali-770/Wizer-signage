import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ContentStatus, Prisma } from '@prisma/client';

import { PasswordService } from '../../common/crypto/password.service';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityCategory, ActivityLogService } from '../activity-log/activity-log.service';
import { UsageLimitsService } from '../usage-limits/usage-limits.service';
import type { UpdateCompanySettingsDto } from './dto/company-settings.dto';

@Injectable()
export class CompanySettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly password: PasswordService,
    private readonly usageLimits: UsageLimitsService,
  ) {}

  /** Current usage vs plan limits for the caller's own company. */
  usage(companyId: string) {
    return this.usageLimits.evaluate(companyId);
  }

  /** Company Admin self-service settings (billing shown read-only). */
  async get(companyId: string) {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      include: {
        subscription: { include: { plan: { select: { name: true, code: true, limits: true } } } },
      },
    });
    if (!company) throw new NotFoundException('Company not found.');

    const settings = (company.settings ?? {}) as Record<string, unknown>;
    return {
      id: company.id,
      name: company.name,
      slug: company.slug,
      status: company.status,
      defaultLocale: company.defaultLocale,
      timezone: company.timezone,
      defaultWorkingHours: settings.defaultWorkingHours ?? null,
      defaultHeartbeatIntervalSeconds: settings.defaultHeartbeatIntervalSeconds ?? 60,
      notificationEmails: settings.notificationEmails ?? [],
      fallbackContentId: company.fallbackContentId,
      hasDefaultKioskPin: !!company.defaultKioskPinHash,
      // Read-only billing summary (managed by Super Admin).
      plan: company.subscription
        ? {
            name: company.subscription.plan.name,
            code: company.subscription.plan.code,
            status: company.subscription.status,
            limits: company.subscription.plan.limits,
          }
        : null,
    };
  }

  async update(companyId: string, actor: AuthenticatedUser, dto: UpdateCompanySettingsDto) {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: { settings: true },
    });
    if (!company) throw new NotFoundException('Company not found.');

    // Normalize "" → null so clearing the fallback never persists an empty id,
    // and validate any non-empty id against ACTIVE same-company content.
    const fallbackContentId =
      dto.fallbackContentId === undefined ? undefined : dto.fallbackContentId?.trim() || null;
    if (fallbackContentId) {
      const content = await this.prisma.content.findFirst({
        where: { id: fallbackContentId, companyId, status: ContentStatus.ACTIVE, deletedAt: null },
        select: { id: true },
      });
      if (!content) {
        throw new BadRequestException(
          'Fallback content must be an active content item in your company.',
        );
      }
    }

    const settings = { ...((company.settings ?? {}) as Record<string, unknown>) };
    if (dto.defaultWorkingHours !== undefined)
      settings.defaultWorkingHours = dto.defaultWorkingHours;
    if (dto.defaultHeartbeatIntervalSeconds !== undefined) {
      settings.defaultHeartbeatIntervalSeconds = dto.defaultHeartbeatIntervalSeconds;
    }
    if (dto.notificationEmails !== undefined) settings.notificationEmails = dto.notificationEmails;

    const data: Prisma.CompanyUpdateInput = { settings: settings as Prisma.InputJsonValue };
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.defaultLocale !== undefined) data.defaultLocale = dto.defaultLocale;
    if (dto.timezone !== undefined) data.timezone = dto.timezone;
    if (fallbackContentId !== undefined) data.fallbackContentId = fallbackContentId;

    await this.prisma.company.update({ where: { id: companyId }, data });
    await this.log(actor, companyId, 'company.settings_changed', {
      changes: [
        ...Object.keys(data).filter((k) => k !== 'settings'),
        ...Object.keys(settings).map((k) => `settings.${k}`),
      ],
    });
    return this.get(companyId);
  }

  async setDefaultKioskPin(companyId: string, actor: AuthenticatedUser, pin: string) {
    await this.prisma.company.update({
      where: { id: companyId },
      data: { defaultKioskPinHash: await this.password.hash(pin) },
    });
    await this.log(actor, companyId, 'company.kiosk_pin_changed');
    return { updated: true };
  }

  async resetDefaultKioskPin(companyId: string, actor: AuthenticatedUser) {
    await this.prisma.company.update({
      where: { id: companyId },
      data: { defaultKioskPinHash: null },
    });
    await this.log(actor, companyId, 'company.kiosk_pin_reset');
    return { reset: true };
  }

  private log(
    actor: AuthenticatedUser,
    companyId: string,
    action: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    return this.activityLog.log({
      action,
      category: ActivityCategory.COMPANY,
      actorId: actor.userId,
      companyId,
      targetType: 'company',
      targetId: companyId,
      metadata,
    });
  }
}
