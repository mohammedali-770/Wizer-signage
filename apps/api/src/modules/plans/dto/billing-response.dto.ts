import { BillingInterval, CompanyStatus, InvoiceStatus, SubscriptionStatus } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { PlanLimitsViewDto } from '../../usage-limits/dto/usage-response.dto';

/**
 * Billing response shapes — plans, subscriptions and invoices.
 *
 * None of these three services has a view: every route returns the raw Prisma
 * row (with whatever relations the query included). So these are transcribed
 * from the MODEL, which makes them the only record of what the endpoints send,
 * and a new column on any of the three tables becomes part of the response
 * with nothing in the code saying so.
 *
 * MONEY IS A STRING. Every amount here is a `Decimal(12,2)` column, and
 * Prisma's Decimal serialises through `JSON.stringify` as a string, not a
 * number — verified rather than assumed:
 *
 *     JSON.stringify({ priceMonthly: new Prisma.Decimal('49.90') })
 *     // -> {"priceMonthly":"49.9"}
 *
 * Note the second half of that: `49.90` comes back as `"49.9"`. A client
 * cannot rely on two decimal places and must format for display itself.
 *
 * And these strings do NOT agree with the Super Admin overview, where
 * `invoices.unpaidTotal` is a `_sum` already passed through `Number()` and is
 * therefore a JSON number. Same currency, two encodings, on purpose — the same
 * split as `ContentDto.fileSize` (string) versus `usedBytes` (number).
 */

/** A billing plan. Super Admin only. */
export class PlanDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ description: 'Stable machine-readable key. Unique.', example: 'pro' })
  code!: string;

  @ApiPropertyOptional({ nullable: true })
  description?: string | null;

  @ApiProperty({
    type: String,
    description: 'Decimal(12,2) — a STRING on the wire. Trailing zeros are not preserved.',
    example: '49.9',
  })
  priceMonthly!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Decimal(12,2) as a string. null when the plan is not sold yearly.',
  })
  priceYearly?: string | null;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({ enum: Object.values(BillingInterval) })
  billingInterval!: string;

  @ApiProperty({ description: 'Length of the trial a new subscription gets. 0 for none.' })
  trialDays!: number;

  @ApiProperty({ description: 'An inactive plan is hidden but keeps its subscriptions.' })
  isActive!: boolean;

  @ApiProperty({ description: 'Whether the plan is offered publicly.' })
  isPublic!: boolean;

  @ApiProperty({
    type: PlanLimitsViewDto,
    description:
      'The same limit block GET /companies/{id}/usage evaluates against. Absent or null on a ' +
      'field means UNLIMITED, not zero.',
  })
  limits!: PlanLimitsViewDto;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

/** The company summary attached to a subscription read. */
export class SubscriptionCompanyDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty({ enum: Object.values(CompanyStatus) })
  status!: string;
}

/**
 * A subscription as CREATE returns it.
 *
 * `create` includes only `{ plan: true }`; every read and every other write
 * also includes the company summary. A single shared class would tell a client
 * that `company` is always there, and on the create response it never is.
 */
export class SubscriptionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  companyId!: string;

  @ApiProperty()
  planId!: string;

  @ApiProperty({ enum: Object.values(SubscriptionStatus) })
  status!: string;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  trialEndsAt?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  currentPeriodStart?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  currentPeriodEnd?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    format: 'date-time',
    description: 'Set when an over-limit account is given time to come back under.',
  })
  gracePeriodEndsAt?: string | null;

  @ApiProperty({ description: 'Cancel at the end of the paid period rather than immediately.' })
  cancelAtPeriodEnd!: boolean;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  canceledAt?: string | null;

  @ApiProperty({ type: PlanDto })
  plan!: PlanDto;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

/** A subscription as the reads, update and cancel return it: with the company. */
export class SubscriptionWithCompanyDto extends SubscriptionDto {
  @ApiProperty({ type: SubscriptionCompanyDto })
  company!: SubscriptionCompanyDto;
}

/** An invoice. Financial record — retention never deletes one. */
export class InvoiceDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  companyId!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Nulled rather than cascaded if the subscription goes away.',
  })
  subscriptionId?: string | null;

  @ApiProperty({ description: 'Human-facing invoice number. Unique.' })
  number!: string;

  @ApiProperty({ enum: Object.values(InvoiceStatus) })
  status!: string;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({ type: String, description: 'Decimal(12,2) as a string.', example: '100' })
  subtotal!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Decimal(12,2) as a string. null when no tax applies.',
  })
  tax?: string | null;

  @ApiProperty({ type: String, description: 'Decimal(12,2) as a string.', example: '115' })
  total!: string;

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'Free-form JSON line items; nothing in the schema constrains their shape.',
  })
  lineItems!: Record<string, unknown>[];

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  issuedAt?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  dueAt?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  paidAt?: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

/**
 * GET /subscriptions/{id}/history — raw activity-log rows.
 *
 * Not a subscription-specific shape: the endpoint reads the audit trail
 * filtered to `category = SUBSCRIPTION`, and returns the rows as they are.
 * `ip` and `userAgent` come with them, which is the point of an audit trail
 * and is Super-Admin-only.
 */
export class ActivityLogDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional({ nullable: true })
  companyId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Nulled if the actor is deleted.' })
  actorId?: string | null;

  @ApiProperty({ description: 'Dotted event name.', example: 'subscription.updated' })
  action!: string;

  @ApiProperty({ description: 'A plain String column, not an enum.', example: 'SUBSCRIPTION' })
  category!: string;

  @ApiPropertyOptional({ nullable: true })
  targetType?: string | null;

  @ApiPropertyOptional({ nullable: true })
  targetId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  description?: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true })
  metadata!: Record<string, unknown>;

  @ApiPropertyOptional({ nullable: true })
  ip?: string | null;

  @ApiPropertyOptional({ nullable: true })
  userAgent?: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}
