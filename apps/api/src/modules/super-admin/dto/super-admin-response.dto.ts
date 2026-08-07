import { CompanyStatus, DemoRequestStatus, SubscriptionStatus } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Super Admin response shapes for the OpenAPI contract. See
 * `common/dto/api-response.dto.ts` for why these are classes and not the
 * interfaces the services already return.
 *
 * Platform-level, not tenant-level: none of these carry a `companyId` scope,
 * because the caller is outside every tenant. That is also why several of them
 * expose data no company-scoped endpoint would — an impersonator's email, a
 * lead's IP address — and why the descriptions say so out loud.
 *
 * The enums are read from `@prisma/client` rather than written out. Hand-listing
 * them here got three of four wrong on the first pass — invented members
 * (`PAST_DUE`, `QUALIFIED`) alongside real ones — and every mistake compiled,
 * emitted, and would have shipped as a documented value. A generated client
 * builds a union type from these, so an invented member is a value the client
 * accepts and the API rejects.
 */

/** A company row on the overview's "recently created" strip. */
export class RecentCompanyPlanDto {
  @ApiProperty()
  name!: string;

  @ApiProperty()
  code!: string;
}

export class RecentCompanySubscriptionDto {
  @ApiProperty({ enum: Object.values(SubscriptionStatus) })
  status!: string;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  trialEndsAt?: string | null;

  @ApiPropertyOptional({ type: RecentCompanyPlanDto, nullable: true })
  plan?: RecentCompanyPlanDto | null;
}

export class RecentCompanyDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty({ enum: Object.values(CompanyStatus) })
  status!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiPropertyOptional({ type: RecentCompanySubscriptionDto, nullable: true })
  subscription?: RecentCompanySubscriptionDto | null;
}

/** `{ total, byStatus }` — a groupBy count plus its per-status breakdown. */
export class StatusCountsDto {
  @ApiProperty()
  total!: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    description:
      'Every status in the enum, INCLUDING the ones at zero — `toStatusMap` seeds the map ' +
      'from the full enum before folding the groupBy in, so a missing key means a new status ' +
      'the API does not know about rather than a count of none.',
    example: { ACTIVE: 12, SUSPENDED: 0, PENDING: 3, CANCELLED: 0 },
  })
  byStatus!: Record<string, number>;
}

export class ActivePlansDto {
  @ApiProperty()
  active!: number;
}

export class UnpaidInvoicesDto {
  @ApiProperty()
  unpaid!: number;

  @ApiProperty({
    description:
      'A string, like the per-invoice `total` it sums. It used to be summed with Number(), ' +
      'making this the one money value in the API that was a JSON number.',
    example: '1250.00',
  })
  unpaidTotal!: string;
}

export class TotalUsersDto {
  @ApiProperty()
  total!: number;
}

export class ActiveSuperAdminsDto {
  @ApiProperty()
  active!: number;
}

export class TrialCountsDto {
  @ApiProperty({ description: 'Still TRIALING and not past its end date.' })
  active!: number;

  @ApiProperty({
    description:
      'EXPIRED, or TRIALING but past its end date — the second case is a subscription the ' +
      'expiry job has not swept yet, and it counts as expired here rather than as active.',
  })
  expired!: number;
}

export class DemoRequestCountsDto {
  @ApiProperty()
  total!: number;

  @ApiProperty({ description: 'Requests still in NEW status.' })
  new!: number;
}

/** GET /super-admin/overview. */
export class PlatformOverviewDto {
  @ApiProperty({ type: StatusCountsDto })
  companies!: StatusCountsDto;

  @ApiProperty({ type: StatusCountsDto })
  subscriptions!: StatusCountsDto;

  @ApiProperty({ type: ActivePlansDto })
  plans!: ActivePlansDto;

  @ApiProperty({ type: UnpaidInvoicesDto })
  invoices!: UnpaidInvoicesDto;

  @ApiProperty({ type: TotalUsersDto })
  users!: TotalUsersDto;

  @ApiProperty({ type: ActiveSuperAdminsDto })
  superAdmins!: ActiveSuperAdminsDto;

  @ApiProperty({ type: TrialCountsDto })
  trials!: TrialCountsDto;

  @ApiProperty({ description: 'Subscriptions in ACTIVE status.' })
  paidTenants!: number;

  @ApiProperty({ type: DemoRequestCountsDto })
  demoRequests!: DemoRequestCountsDto;

  @ApiProperty({ type: [RecentCompanyDto], description: 'The six most recently created.' })
  recent!: RecentCompanyDto[];
}

/**
 * A live impersonation session.
 *
 * "Who is inside a tenant right now" is the first question of any security
 * review. The view is an allow-list built in the service and deliberately
 * carries the admin's email and originating IP — this endpoint exists to
 * identify a person, so redacting them would defeat it. No token, hash or
 * session secret is included.
 */
export class ActiveImpersonationDto {
  @ApiProperty()
  sessionId!: string;

  @ApiPropertyOptional({ nullable: true })
  adminId?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'admin@example.com' })
  adminEmail?: string | null;

  @ApiPropertyOptional({ nullable: true })
  companyId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  companyName?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'The justification the admin gave when starting it (`impersonationNote`).',
  })
  reason?: string | null;

  @ApiProperty({ format: 'date-time' })
  startedAt!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Where the impersonation was started from.' })
  ip?: string | null;
}

/** The company an impersonation token is scoped to. */
export class ImpersonationCompanyDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

/** POST /super-admin/impersonation. */
export class ImpersonationStartedDto {
  @ApiProperty({
    description: 'Short-lived bearer token scoped to the impersonated company.',
  })
  accessToken!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  @ApiProperty({ type: ImpersonationCompanyDto })
  company!: ImpersonationCompanyDto;

  // No refreshToken, and none should ever be added here: an impersonation
  // cannot be extended, only restarted — which forces a fresh 2FA code and a
  // fresh reason, and writes another pair of audit entries.
}

/**
 * A demo request from the marketing site.
 *
 * Returned as the raw Prisma row — there is no view — so this is transcribed
 * from the model, and `ip` / `userAgent` are part of the response because the
 * endpoint really does send them. They are anti-abuse metadata on an
 * unauthenticated public form, readable only by a Super Admin.
 */
export class AdminDemoRequestDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  companyName?: string | null;

  @ApiProperty({ example: 'lead@example.com' })
  email!: string;

  @ApiPropertyOptional({ nullable: true })
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Fleet size the lead reported.' })
  screens?: number | null;

  @ApiPropertyOptional({ nullable: true })
  message?: string | null;

  @ApiPropertyOptional({ nullable: true, description: "The marketing site's locale, e.g. 'ar'." })
  locale?: string | null;

  @ApiProperty({ enum: Object.values(DemoRequestStatus) })
  status!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Captured for abuse triage.' })
  ip?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Captured for abuse triage.' })
  userAgent?: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
