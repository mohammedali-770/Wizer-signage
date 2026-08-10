import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ContentStatus, Prisma } from '@prisma/client';

import { PasswordService } from '../../common/crypto/password.service';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityCategory, ActivityLogService } from '../activity-log/activity-log.service';
import { AndroidReleaseCatalogService } from '../downloads/android-release-catalog.service';
import { UsageLimitsService } from '../usage-limits/usage-limits.service';
import type { AndroidOtaSettingsDto, UpdateCompanySettingsDto } from './dto/company-settings.dto';

@Injectable()
export class CompanySettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly password: PasswordService,
    private readonly usageLimits: UsageLimitsService,
    private readonly androidReleases: AndroidReleaseCatalogService,
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
    const androidOta = (settings.androidOta ?? {}) as Record<string, unknown>;
    const rollbackRaw =
      androidOta.lastAutoRollback &&
      typeof androidOta.lastAutoRollback === 'object' &&
      !Array.isArray(androidOta.lastAutoRollback)
        ? (androidOta.lastAutoRollback as Record<string, unknown>)
        : null;
    const lastAutoRollback =
      rollbackRaw &&
      typeof rollbackRaw.triggeredAt === 'string' &&
      typeof rollbackRaw.fromVersionName === 'string' &&
      typeof rollbackRaw.fromVersionCode === 'number' &&
      typeof rollbackRaw.toVersionName === 'string' &&
      typeof rollbackRaw.toVersionCode === 'number'
        ? {
            triggeredAt: rollbackRaw.triggeredAt,
            fromVersionName: rollbackRaw.fromVersionName,
            fromVersionCode: rollbackRaw.fromVersionCode,
            toVersionName: rollbackRaw.toVersionName,
            toVersionCode: rollbackRaw.toVersionCode,
            failedScreenIds: Array.isArray(rollbackRaw.failedScreenIds)
              ? rollbackRaw.failedScreenIds.filter((id): id is string => typeof id === 'string').slice(0, 50)
              : [],
          }
        : null;

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
      androidOta: {
        enabled: androidOta.enabled === true,
        policyRevision:
          typeof androidOta.policyRevision === 'string' ? androidOta.policyRevision : null,
        targetVersionName:
          typeof androidOta.targetVersionName === 'string' ? androidOta.targetVersionName : null,
        targetVersionCode:
          typeof androidOta.targetVersionCode === 'number' ? androidOta.targetVersionCode : null,
        rollbackVersionName:
          typeof androidOta.rollbackVersionName === 'string' ? androidOta.rollbackVersionName : null,
        rollbackVersionCode:
          typeof androidOta.rollbackVersionCode === 'number' ? androidOta.rollbackVersionCode : null,
        rolloutPercent:
          typeof androidOta.rolloutPercent === 'number' ? androidOta.rolloutPercent : 0,
        screenIds: Array.isArray(androidOta.screenIds) ? androidOta.screenIds : [],
        groupIds: Array.isArray(androidOta.groupIds) ? androidOta.groupIds : [],
        checkIntervalSeconds:
          typeof androidOta.checkIntervalSeconds === 'number' ? androidOta.checkIntervalSeconds : 21_600,
        healthWindowSeconds:
          typeof androidOta.healthWindowSeconds === 'number' ? androidOta.healthWindowSeconds : 900,
        lastAutoRollback,
      },
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
    if (dto.defaultWorkingHours !== undefined) settings.defaultWorkingHours = dto.defaultWorkingHours;
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

  /**
   * Replace the complete staged-rollout policy. Every explicit save receives a
   * new revision token.
   *
   * Enabling is fail-closed: candidate + known-good recovery artifacts must be
   * fully published and the recovery versionCode must move forward. Disabling
   * is deliberately fail-open with respect to those validations: an emergency
   * halt must still work after an artifact is deleted, a canary is removed, or
   * a prior policy is partially corrupted.
   */
  async updateAndroidOta(companyId: string, actor: AuthenticatedUser, dto: AndroidOtaSettingsDto) {
    const targetVersionName = dto.targetVersionName?.trim() || null;
    const targetVersionCode = dto.targetVersionCode ?? null;
    const rollbackVersionName = dto.rollbackVersionName?.trim() || null;
    const rollbackVersionCode = dto.rollbackVersionCode ?? null;

    if (dto.enabled) {
      const candidatePairComplete = (targetVersionName === null) === (targetVersionCode === null);
      const rollbackPairComplete = (rollbackVersionName === null) === (rollbackVersionCode === null);
      if (!candidatePairComplete) {
        throw new BadRequestException('targetVersionName and targetVersionCode must be supplied together.');
      }
      if (!rollbackPairComplete) {
        throw new BadRequestException('rollbackVersionName and rollbackVersionCode must be supplied together.');
      }
      if (
        !targetVersionName ||
        targetVersionCode === null ||
        !rollbackVersionName ||
        rollbackVersionCode === null
      ) {
        throw new BadRequestException(
          'Candidate and rollback versionName/versionCode are required before Android OTA can be enabled.',
        );
      }
      if (rollbackVersionCode <= targetVersionCode) {
        throw new BadRequestException(
          'rollbackVersionCode must be greater than targetVersionCode so Android can install the rollback as a forward update.',
        );
      }
      if (!this.androidReleases.find(targetVersionName, targetVersionCode)) {
        throw new BadRequestException(
          `Candidate Android release ${targetVersionName}/${targetVersionCode} is not published or failed immutable-manifest verification.`,
        );
      }
      if (!this.androidReleases.find(rollbackVersionName, rollbackVersionCode)) {
        throw new BadRequestException(
          `Rollback Android release ${rollbackVersionName}/${rollbackVersionCode} is not published or failed immutable-manifest verification.`,
        );
      }
    }

    const company = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: { settings: true },
    });
    if (!company) throw new NotFoundException('Company not found.');

    const screenIds = [...new Set(dto.screenIds ?? [])];
    const groupIds = [...new Set(dto.groupIds ?? [])];

    // Ownership is an enablement gate, not a halt gate. A deleted canary must
    // never make the emergency stop button unusable.
    if (dto.enabled && screenIds.length > 0) {
      const owned = await this.prisma.screen.count({
        where: { companyId, id: { in: screenIds }, deletedAt: null },
      });
      if (owned !== screenIds.length) {
        throw new BadRequestException('Every OTA canary screen must belong to your company.');
      }
    }
    if (dto.enabled && groupIds.length > 0) {
      const owned = await this.prisma.screenGroup.count({
        where: { companyId, id: { in: groupIds } },
      });
      if (owned !== groupIds.length) {
        throw new BadRequestException('Every OTA canary group must belong to your company.');
      }
    }

    const previousSettings = (company.settings ?? {}) as Record<string, unknown>;
    const previousOta =
      previousSettings.androidOta &&
      typeof previousSettings.androidOta === 'object' &&
      !Array.isArray(previousSettings.androidOta)
        ? (previousSettings.androidOta as Record<string, unknown>)
        : {};
    const policy = {
      enabled: dto.enabled,
      policyRevision: new Date().toISOString(),
      targetVersionName,
      targetVersionCode,
      rollbackVersionName,
      rollbackVersionCode,
      rolloutPercent: dto.rolloutPercent,
      screenIds,
      groupIds,
      checkIntervalSeconds: dto.checkIntervalSeconds ?? 21_600,
      healthWindowSeconds: dto.healthWindowSeconds ?? 900,
      lastAutoRollback: previousOta.lastAutoRollback ?? null,
    };
    const settings = {
      ...previousSettings,
      androidOta: policy,
    };

    await this.prisma.company.update({
      where: { id: companyId },
      data: { settings: settings as Prisma.InputJsonValue },
    });
    await this.log(actor, companyId, 'company.android_ota_policy_changed', {
      enabled: policy.enabled,
      policyRevision: policy.policyRevision,
      targetVersionName: policy.targetVersionName,
      targetVersionCode: policy.targetVersionCode,
      rollbackVersionName: policy.rollbackVersionName,
      rollbackVersionCode: policy.rollbackVersionCode,
      rolloutPercent: policy.rolloutPercent,
      canaryScreenCount: screenIds.length,
      canaryGroupCount: groupIds.length,
      checkIntervalSeconds: policy.checkIntervalSeconds,
      healthWindowSeconds: policy.healthWindowSeconds,
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
