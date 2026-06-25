import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Plan, SubscriptionStatus, UserRole, UserStatus } from '@prisma/client';

import { PasswordService } from '../../common/crypto/password.service';
import type { RequestMeta } from '../../common/decorators/request-meta.decorator';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityCategory, ActivityLogService } from '../activity-log/activity-log.service';
import { MailService } from '../mail/mail.service';
import type { DemoRequestDto } from './dto/demo-request.dto';
import type { TrialSignupDto } from './dto/trial-signup.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** Public-facing plan shape for the marketing pricing page (no internal flags). */
export interface PublicPlanView {
  id: string;
  name: string;
  code: string;
  description: string | null;
  priceMonthly: number;
  priceYearly: number | null;
  currency: string;
  trialDays: number;
  limits: Record<string, unknown>;
}

@Injectable()
export class PublicService {
  private readonly logger = new Logger(PublicService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly password: PasswordService,
    private readonly activityLog: ActivityLogService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Self-service trial signup. Atomically creates a tenant (Company), its owner
   * (a COMPANY_ADMIN — NOT a platform Super Admin), a TRIALING subscription, and
   * a default branch (Location). Returns where to send the user to sign in.
   */
  async trialSignup(dto: TrialSignupDto, meta: RequestMeta) {
    const email = dto.email.toLowerCase().trim();

    // 1. Duplicate-email guard (email is globally unique).
    const existing = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists.');
    }

    // 2. Password strength (>= 10 chars, mixed classes, not a common password).
    const policy = this.password.evaluate(dto.password);
    if (!policy.valid) {
      throw new BadRequestException(policy.errors[0] ?? 'Password does not meet the requirements.');
    }

    // 3. Resolve the trial plan: configured code first, else cheapest active plan.
    const plan = await this.resolveTrialPlan();
    const trialConfig = this.config.get<AppConfig['trial']>('trial', { infer: true });
    const trialDays = plan.trialDays > 0 ? plan.trialDays : (trialConfig?.days ?? 14);
    const trialEndsAt = new Date(Date.now() + trialDays * DAY_MS);

    const locale = dto.preferredLanguage ?? 'en';
    const slug = await this.uniqueSlug(slugify(dto.companyName) || 'company');
    const passwordHash = await this.password.hash(dto.password);

    // Non-PII signup context kept on the company for the Super Admin to see.
    const signupMeta = {
      contactName: dto.fullName,
      phone: dto.phone ?? null,
      country: dto.country ?? null,
      city: dto.city ?? null,
      businessType: dto.businessType ?? null,
      branches: dto.branches ?? null,
      screens: dto.screens ?? null,
      source: 'marketing-trial',
      at: new Date().toISOString(),
    };

    // 4. Atomic tenant bootstrap.
    let result: { companyId: string; ownerId: string };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const company = await tx.company.create({
          data: {
            name: dto.companyName.trim(),
            slug,
            status: 'ACTIVE',
            defaultLocale: locale,
            settings: { signup: signupMeta },
            subscription: {
              create: {
                planId: plan.id,
                status: SubscriptionStatus.TRIALING,
                trialEndsAt,
                currentPeriodStart: new Date(),
              },
            },
          },
        });

        const owner = await tx.user.create({
          data: {
            companyId: company.id,
            email,
            name: dto.fullName.trim(),
            role: UserRole.COMPANY_ADMIN,
            status: UserStatus.ACTIVE,
            locale,
            passwordHash,
            emailVerifiedAt: new Date(),
            passwordHistory: { create: { passwordHash } },
          },
        });

        await tx.location.create({
          data: {
            companyId: company.id,
            name: dto.city ? `${dto.city} Branch` : 'Main Branch',
            city: dto.city ?? null,
            country: dto.country ?? null,
            status: 'ACTIVE',
          },
        });

        return { companyId: company.id, ownerId: owner.id };
      });
    } catch (err) {
      // Unique-constraint race (email/slug) → friendly 409.
      if (typeof err === 'object' && err && (err as { code?: string }).code === 'P2002') {
        throw new ConflictException('An account with this email already exists.');
      }
      throw err;
    }

    // 5. Audit log (best-effort; never throws).
    await this.activityLog.log({
      action: 'trial.signup',
      category: ActivityCategory.COMPANY,
      companyId: result.companyId,
      actorId: result.ownerId,
      targetType: 'company',
      targetId: result.companyId,
      metadata: { email, planCode: plan.code, trialDays, ...signupMeta },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    // 6. Welcome email (best-effort — must not fail the signup).
    void this.sendWelcomeEmail(email, dto.fullName.trim(), locale, trialEndsAt);

    return {
      companyId: result.companyId,
      slug,
      email,
      trialEndsAt: trialEndsAt.toISOString(),
      redirectUrl: `${this.dashboardUrl()}/login`,
    };
  }

  /** Store a "Book a Demo" lead and notify sales (best-effort). */
  async demoRequest(dto: DemoRequestDto, meta: RequestMeta) {
    const email = dto.email.toLowerCase().trim();
    const created = await this.prisma.demoRequest.create({
      data: {
        name: dto.name.trim(),
        companyName: dto.company?.trim() || null,
        email,
        phone: dto.phone ?? null,
        screens: dto.screens ?? null,
        message: dto.message ?? null,
        locale: dto.locale ?? null,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      },
    });

    await this.activityLog.log({
      action: 'demo.requested',
      category: 'MARKETING',
      companyId: null,
      targetType: 'demo_request',
      targetId: created.id,
      metadata: { email, company: dto.company ?? null, screens: dto.screens ?? null },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    void this.sendDemoNotification(created.id, dto);

    return { id: created.id, status: 'received' as const };
  }

  /** Active, public plans for the marketing pricing page. */
  async listPublicPlans(): Promise<PublicPlanView[]> {
    const plans = await this.prisma.plan.findMany({
      where: { isActive: true, isPublic: true },
      orderBy: { priceMonthly: 'asc' },
    });
    return plans.map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      description: p.description,
      priceMonthly: Number(p.priceMonthly),
      priceYearly: p.priceYearly === null ? null : Number(p.priceYearly),
      currency: p.currency,
      trialDays: p.trialDays,
      limits: (p.limits as Record<string, unknown>) ?? {},
    }));
  }

  // --- Internals ----------------------------------------------------------

  private async resolveTrialPlan(): Promise<Plan> {
    const trialConfig = this.config.get<AppConfig['trial']>('trial', { infer: true });
    const code = trialConfig?.defaultPlanCode ?? 'starter';
    const byCode = await this.prisma.plan.findUnique({ where: { code } });
    if (byCode && byCode.isActive) return byCode;
    const cheapest = await this.prisma.plan.findFirst({
      where: { isActive: true },
      orderBy: { priceMonthly: 'asc' },
    });
    if (!cheapest) {
      throw new ServiceUnavailableException('No subscription plan is available. Try again later.');
    }
    return cheapest;
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

  private dashboardUrl(): string {
    return this.config.get<AppConfig['app']>('app', { infer: true })?.dashboardUrl ?? '';
  }

  private async sendWelcomeEmail(
    email: string,
    name: string,
    locale: string,
    trialEndsAt: Date,
  ): Promise<void> {
    const loginUrl = `${this.dashboardUrl()}/${locale}/login`;
    const ends = trialEndsAt.toISOString().slice(0, 10);
    const text =
      locale === 'ar'
        ? `مرحبًا ${name}،\n\nتم تفعيل حسابك التجريبي في ماستر ساينيج وهو صالح حتى ${ends}.\n\nسجّل الدخول: ${loginUrl}\n`
        : `Hi ${name},\n\nYour MasterSignage trial is active until ${ends}.\n\nSign in: ${loginUrl}\n`;
    try {
      await this.mail.send({
        to: email,
        subject: locale === 'ar' ? 'مرحبًا بك في ماستر ساينيج' : 'Welcome to MasterSignage',
        text,
      });
    } catch (err) {
      this.logger.warn(
        `Trial welcome email to ${email} failed (continuing): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async sendDemoNotification(id: string, dto: DemoRequestDto): Promise<void> {
    const to = process.env.SALES_NOTIFY_EMAIL ?? process.env.SMTP_FROM;
    if (!to) return;
    try {
      await this.mail.send({
        to,
        subject: `New demo request — ${dto.company ?? dto.name}`,
        text:
          `New "Book a Demo" submission (${id}):\n\n` +
          `Name: ${dto.name}\nCompany: ${dto.company ?? '-'}\nEmail: ${dto.email}\n` +
          `Phone: ${dto.phone ?? '-'}\nScreens: ${dto.screens ?? '-'}\n\n` +
          `Message:\n${dto.message ?? '-'}\n`,
      });
    } catch (err) {
      this.logger.warn(
        `Demo-request notification failed (continuing): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
