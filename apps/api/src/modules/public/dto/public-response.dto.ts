import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { PlanLimitsViewDto } from '../../usage-limits/dto/usage-response.dto';

/**
 * Responses for the unauthenticated marketing-site endpoints.
 *
 * These are the only routes on the platform a stranger can reach, so what they
 * return is deliberately thin: an id and a redirect after signup, an
 * acknowledgement after a demo request, and the public half of the plan table.
 * No tokens, no session, no company detail beyond the slug the user chose.
 */

/**
 * A public plan for the pricing page.
 *
 * MONEY IS A STRING HERE, as it is everywhere else.
 *
 * It used to be a number: `listPublicPlans` mapped each row through
 * `Number(p.priceMonthly)` while the Super Admin endpoint returned the raw
 * Prisma Decimal, so the same column was a JSON number on one endpoint and a
 * string on the other. A client sharing a Plan type between the marketing site
 * and the admin dashboard was wrong on one of them. A Decimal round-tripped
 * through a JS float can also lose precision, and this is billing data.
 *
 * It is also a much narrower row: no `isActive`, no `isPublic`, no
 * `billingInterval`, no timestamps. Only what a pricing page renders.
 */
export class PublicPlanDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ example: 'pro' })
  code!: string;

  @ApiPropertyOptional({ nullable: true })
  description?: string | null;

  @ApiProperty({
    description:
      'The raw Decimal as a string, matching GET /plans and every other money field. Parse it ' +
      'before doing arithmetic; do not assume a JS number round-trips it exactly.',
    example: '49.90',
  })
  priceMonthly!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'A string, or null when the plan is not sold yearly.',
    example: '499.00',
  })
  priceYearly?: string | null;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty()
  trialDays!: number;

  @ApiProperty({ type: PlanLimitsViewDto, description: '`{}` when the plan sets no limits.' })
  limits!: PlanLimitsViewDto;
}

/** POST /public/trial-signup. */
export class TrialSignupResultDto {
  @ApiProperty()
  companyId!: string;

  @ApiProperty({
    description: 'The tenant slug, as allocated — may differ from what was asked for.',
  })
  slug!: string;

  @ApiProperty({ example: 'owner@example.com' })
  email!: string;

  @ApiProperty({ format: 'date-time' })
  trialEndsAt!: string;

  @ApiProperty({
    description:
      'Where to send the browser next. NO tokens are issued here — the owner signs in normally, ' +
      'so an unauthenticated endpoint never mints a session.',
  })
  redirectUrl!: string;
}

/**
 * POST /public/demo-request.
 *
 * Deliberately uniform: the same body whatever the submission contained, so the
 * endpoint cannot be probed for what it accepted or who already exists.
 */
export class DemoRequestResultDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['received'], example: 'received' })
  status!: string;
}
