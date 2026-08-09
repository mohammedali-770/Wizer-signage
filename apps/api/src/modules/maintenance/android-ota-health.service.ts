import { Injectable, Logger } from '@nestjs/common';
import { NotificationSeverity, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AndroidReleaseCatalogService } from '../downloads/android-release-catalog.service';
import { AlertService } from '../notifications/alert.service';
import { AlertEvent } from '../notifications/notifications.constants';

const VERSION_NAME_RE = /^(?!.*\.\.)[A-Za-z0-9._-]+$/;
const POLICY_REVISION_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const COMPANY_PAGE = 500;
const FAILED_SCREEN_SAMPLE = 50;

type Policy = {
  enabled: true;
  policyRevision: string;
  targetVersionName: string;
  targetVersionCode: number;
  rollbackVersionName: string;
  rollbackVersionCode: number;
  rolloutPercent: number;
  screenIds: string[];
  groupIds: string[];
  checkIntervalSeconds: number;
  healthWindowSeconds: number;
  lastAutoRollback: unknown;
};

type Attempt = {
  state?: unknown;
  policyRevision?: unknown;
  targetVersionCode?: unknown;
  reportedAt?: unknown;
};

@Injectable()
export class AndroidOtaHealthService {
  private readonly logger = new Logger(AndroidOtaHealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertService,
    private readonly releases: AndroidReleaseCatalogService,
  ) {}

  /**
   * Reconcile armed OTA policies. Safe to call on every maintenance run.
   *
   * A candidate gets one health window after the player reports INSTALLING or
   * INSTALLED. It is considered proven when the same screen subsequently sends
   * a heartbeat carrying the exact candidate version and the device snapshot is
   * clean (no playback error, failed/partial sync, or lastSyncError). Once that
   * happened, a later unrelated outage does not retroactively fail the rollout.
   *
   * Attempt telemetry is also bound to policyRevision. Re-saving the same
   * candidate after remediation therefore cannot inherit an old failed attempt
   * and immediately trip the new revision's health window.
   */
  async sweep(now: Date = new Date()) {
    let checkedPolicies = 0;
    let failedScreens = 0;
    let autoRevertedPolicies = 0;
    let haltedMissingRollback = 0;
    let cursor: string | undefined;

    for (;;) {
      const companies = await this.prisma.company.findMany({
        where: {
          deletedAt: null,
          settings: { path: ['androidOta', 'enabled'], equals: true },
        },
        select: { id: true, settings: true },
        orderBy: { id: 'asc' },
        take: COMPANY_PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (companies.length === 0) break;

      for (const company of companies) {
        const policy = this.parsePolicy(company.settings);
        if (!policy) continue;
        checkedPolicies++;

        const attempts = await this.prisma.screen.findMany({
          where: {
            companyId: company.id,
            deletedAt: null,
            capabilities: {
              path: ['androidOta', 'targetVersionCode'],
              equals: policy.targetVersionCode,
            },
          },
          select: {
            id: true,
            appVersion: true,
            lastHeartbeatAt: true,
            capabilities: true,
            device: {
              select: {
                playbackState: true,
                syncStatus: true,
                lastSyncError: true,
              },
            },
          },
        });

        const failing: string[] = [];
        for (const screen of attempts) {
          const attempt = this.parseAttempt(screen.capabilities);
          if (!attempt || (attempt.state !== 'INSTALLING' && attempt.state !== 'INSTALLED')) continue;
          if (
            attempt.targetVersionCode !== policy.targetVersionCode ||
            attempt.policyRevision !== policy.policyRevision
          ) {
            continue;
          }
          const startedAtMs = Date.parse(attempt.reportedAt);
          if (!Number.isFinite(startedAtMs)) continue;
          if (now.getTime() - startedAtMs < policy.healthWindowSeconds * 1000) continue;

          const sentCandidateHeartbeat =
            screen.appVersion?.trim() === policy.targetVersionName &&
            !!screen.lastHeartbeatAt &&
            screen.lastHeartbeatAt.getTime() >= startedAtMs;
          const cleanSnapshot =
            !!screen.device &&
            screen.device.playbackState !== 'ERROR' &&
            screen.device.syncStatus !== 'FAILED' &&
            screen.device.syncStatus !== 'PARTIAL' &&
            !screen.device.lastSyncError;
          if (!sentCandidateHeartbeat || !cleanSnapshot) failing.push(screen.id);
        }

        if (failing.length === 0) continue;
        failedScreens += failing.length;
        const rollbackAvailable = !!this.releases.find(
          policy.rollbackVersionName,
          policy.rollbackVersionCode,
        );
        const nextRevision = now.toISOString();
        const lastAutoRollback = {
          triggeredAt: nextRevision,
          fromVersionName: policy.targetVersionName,
          fromVersionCode: policy.targetVersionCode,
          toVersionName: policy.rollbackVersionName,
          toVersionCode: policy.rollbackVersionCode,
          failedScreenIds: failing.slice(0, FAILED_SCREEN_SAMPLE),
        };
        const replacement = rollbackAvailable
          ? {
              ...policy,
              enabled: true,
              policyRevision: nextRevision,
              targetVersionName: policy.rollbackVersionName,
              targetVersionCode: policy.rollbackVersionCode,
              // The automatic recovery target is already the pre-staged safe
              // build. A future candidate must be explicitly armed with a NEW
              // higher forward-rollback coordinate before rollout can resume.
              rollbackVersionName: null,
              rollbackVersionCode: null,
              lastAutoRollback,
            }
          : {
              ...policy,
              enabled: false,
              policyRevision: nextRevision,
              lastAutoRollback,
            };

        // Compare-and-swap only the androidOta JSON object. This cannot overwrite
        // a newer operator save (revision predicate), nor unrelated company
        // settings changed concurrently (jsonb_set rather than a stale full JSON
        // replacement).
        const updated = await this.prisma.$executeRaw(
          Prisma.sql`
            UPDATE "companies"
            SET "settings" = jsonb_set(
                  COALESCE("settings", '{}'::jsonb),
                  '{androidOta}',
                  ${JSON.stringify(replacement)}::jsonb,
                  true
                ),
                "updatedAt" = ${now}
            WHERE "id" = ${company.id}
              AND "deletedAt" IS NULL
              AND "settings"->'androidOta'->>'policyRevision' = ${policy.policyRevision}
          `,
        );
        if (Number(updated) !== 1) {
          this.logger.log(
            `Skipped stale OTA health transition for company ${company.id}; policy revision changed concurrently.`,
          );
          continue;
        }

        if (rollbackAvailable) autoRevertedPolicies++;
        else haltedMissingRollback++;

        await this.alerts.raise({
          companyId: company.id,
          type: AlertEvent.AndroidOtaAutoRollback,
          severity: NotificationSeverity.CRITICAL,
          title: rollbackAvailable
            ? 'Android OTA automatically reverted'
            : 'Android OTA halted — rollback artifact unavailable',
          message: rollbackAvailable
            ? `${failing.length} screen(s) failed to prove a healthy ${policy.targetVersionName}/${policy.targetVersionCode} heartbeat within ${policy.healthWindowSeconds}s. The rollout cohort was switched automatically to ${policy.rollbackVersionName}/${policy.rollbackVersionCode}.`
            : `${failing.length} screen(s) failed the OTA health gate, but the configured rollback release is no longer verifiable. New installs were halted immediately; operator recovery is required.`,
          dedupeKey: `${company.id}:android.ota.auto_rollback:${policy.policyRevision}`,
          metadata: {
            policyRevision: policy.policyRevision,
            failedScreenIds: failing.slice(0, FAILED_SCREEN_SAMPLE),
            failedScreenCount: failing.length,
            fromVersionName: policy.targetVersionName,
            fromVersionCode: policy.targetVersionCode,
            toVersionName: policy.rollbackVersionName,
            toVersionCode: policy.rollbackVersionCode,
            rollbackAvailable,
            healthWindowSeconds: policy.healthWindowSeconds,
          },
          // A successful automatic revert has already resolved the condition;
          // keep it in notification/history without leaving a permanently OPEN
          // alert. Missing rollback remains OPEN because human recovery is still
          // required.
          informational: rollbackAvailable,
        });
      }

      if (companies.length < COMPANY_PAGE) break;
      cursor = companies[companies.length - 1]?.id;
      if (!cursor) break;
    }

    const result = {
      checkedPolicies,
      failedScreens,
      autoRevertedPolicies,
      haltedMissingRollback,
    };
    if (autoRevertedPolicies || haltedMissingRollback) {
      this.logger.warn(`Android OTA health sweep: ${JSON.stringify(result)}`);
    }
    return result;
  }

  private parsePolicy(settingsValue: unknown): Policy | null {
    if (!settingsValue || typeof settingsValue !== 'object' || Array.isArray(settingsValue)) return null;
    const settings = settingsValue as Record<string, unknown>;
    if (!settings.androidOta || typeof settings.androidOta !== 'object' || Array.isArray(settings.androidOta)) {
      return null;
    }
    const raw = settings.androidOta as Record<string, unknown>;
    const name = typeof raw.targetVersionName === 'string' ? raw.targetVersionName.trim() : '';
    const rollbackName =
      typeof raw.rollbackVersionName === 'string' ? raw.rollbackVersionName.trim() : '';
    const code = Number(raw.targetVersionCode);
    const rollbackCode = Number(raw.rollbackVersionCode);
    const revision = typeof raw.policyRevision === 'string' ? raw.policyRevision : '';
    const healthWindow = Number(raw.healthWindowSeconds);
    if (
      raw.enabled !== true ||
      !POLICY_REVISION_RE.test(revision) ||
      !name ||
      name.length > 64 ||
      !VERSION_NAME_RE.test(name) ||
      !rollbackName ||
      rollbackName.length > 64 ||
      !VERSION_NAME_RE.test(rollbackName) ||
      !Number.isInteger(code) ||
      code <= 0 ||
      !Number.isInteger(rollbackCode) ||
      rollbackCode <= code ||
      !Number.isInteger(healthWindow) ||
      healthWindow < 300 ||
      healthWindow > 3600
    ) {
      return null;
    }
    return {
      enabled: true,
      policyRevision: revision,
      targetVersionName: name,
      targetVersionCode: code,
      rollbackVersionName: rollbackName,
      rollbackVersionCode: rollbackCode,
      rolloutPercent: Math.max(0, Math.min(100, Math.trunc(Number(raw.rolloutPercent) || 0))),
      screenIds: Array.isArray(raw.screenIds)
        ? raw.screenIds.filter((v): v is string => typeof v === 'string').slice(0, 200)
        : [],
      groupIds: Array.isArray(raw.groupIds)
        ? raw.groupIds.filter((v): v is string => typeof v === 'string').slice(0, 100)
        : [],
      checkIntervalSeconds: Math.max(
        900,
        Math.min(86_400, Math.trunc(Number(raw.checkIntervalSeconds) || 21_600)),
      ),
      healthWindowSeconds: healthWindow,
      lastAutoRollback: raw.lastAutoRollback ?? null,
    };
  }

  private parseAttempt(
    capabilitiesValue: unknown,
  ): (Attempt & { policyRevision: string; reportedAt: string }) | null {
    if (!capabilitiesValue || typeof capabilitiesValue !== 'object' || Array.isArray(capabilitiesValue)) {
      return null;
    }
    const capabilities = capabilitiesValue as Record<string, unknown>;
    if (!capabilities.androidOta || typeof capabilities.androidOta !== 'object' || Array.isArray(capabilities.androidOta)) {
      return null;
    }
    const raw = capabilities.androidOta as Attempt;
    if (
      typeof raw.reportedAt !== 'string' ||
      typeof raw.policyRevision !== 'string' ||
      !POLICY_REVISION_RE.test(raw.policyRevision)
    ) {
      return null;
    }
    return { ...raw, policyRevision: raw.policyRevision, reportedAt: raw.reportedAt };
  }
}
