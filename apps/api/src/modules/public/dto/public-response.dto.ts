import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { PlanLimitsDto } from '../../usage-limits/dto/usage-response.dto';

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
 * MONEY IS A NUMBER HERE, and a string on GET /plans.
 *
 * `listPublicPlans` maps each row through `Number(p.priceMonthly)`; the Super
 * Admin endpoint returns the raw Prisma Decimal, which serialises as a string.
 * Same column, same field name, two encodings, two endpoints — a client that
 * shares a Plan type between the marketing site and the admin dashboard will
 * be wrong on one of them.
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
      'A NUMBER here — passed through Number(). GET /plans returns the same column as a string.',
    example: 49.9,
  })
  priceMonthly!: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'A number, or null when the plan is not sold yearly.',
    example: 499,
  })
  priceYearly?: number | null;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty()
  trialDays!: number;

  @ApiProperty({ type: PlanLimitsDto, description: '`{}` when the plan sets no limits.' })
  limits!: PlanLimitsDto;
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
