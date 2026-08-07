import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SubscriptionStatus } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class CreateSubscriptionDto {
  /** Target company (Super Admin specifies the tenant). */
  @ApiProperty({
    description:
      'The tenant this subscription is for. A Super Admin route, so the company is named in the ' +
      'body rather than taken from the token — one of the few places that is legitimate.',
  })
  @IsString()
  companyId!: string;

  @ApiProperty()
  @IsString()
  planId!: string;

  @ApiPropertyOptional({ enum: Object.values(SubscriptionStatus) })
  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  /** Trial length in days; sets trialEndsAt when status is TRIALING. */
  @ApiPropertyOptional({
    description:
      'Converted to a trialEndsAt date, and ONLY when status is TRIALING — sending it with any ' +
      'other status has no effect and is not rejected.',
    minimum: 0,
    maximum: 365,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  trialDays?: number;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  currentPeriodStart?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  currentPeriodEnd?: string;
}

/**
 * Note the asymmetry with create: that takes `trialDays` (a length), this takes
 * `trialEndsAt` (a date). Neither endpoint accepts both.
 */
export class UpdateSubscriptionDto {
  /** Change the plan. */
  @ApiPropertyOptional({ description: 'Moves the tenant to another plan.' })
  @IsOptional()
  @IsString()
  planId?: string;

  @ApiPropertyOptional({ enum: Object.values(SubscriptionStatus) })
  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'A DATE here, where create takes `trialDays`, a count.',
  })
  @IsOptional()
  @IsDateString()
  trialEndsAt?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  currentPeriodStart?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  currentPeriodEnd?: string;

  @ApiPropertyOptional({ description: 'Ends the subscription at period end rather than now.' })
  @IsOptional()
  @IsBoolean()
  cancelAtPeriodEnd?: boolean;
}

export class ListSubscriptionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
