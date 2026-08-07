import { BillingInterval } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { PlanLimitsDto } from './plan-limits.dto';

export class CreatePlanDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MaxLength(100)
  name!: string;

  /** Stable machine code (unique), e.g. "starter", "pro". */
  @ApiProperty({
    description: 'Stable machine code, unique across plans. Lowercase letters, digits, hyphens.',
    maxLength: 50,
    pattern: '^[a-z0-9-]+$',
    example: 'pro',
  })
  @IsString()
  @MaxLength(50)
  @Matches(/^[a-z0-9-]+$/, { message: 'code must be lowercase letters, digits, or hyphens.' })
  code!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /** Monthly price. Named to match the response — it used to be sent as `price`. */
  @ApiPropertyOptional({
    description:
      'RENAMED from `price`, which is what the response has always called it — a plan could not ' +
      'be round-tripped by copying fields. Sent as a NUMBER (two decimal places) and returned ' +
      'as a string, because the column is a Decimal: that asymmetry is deliberate, since a JSON ' +
      'request body has no decimal type to send.',
    minimum: 0,
    maximum: 1000000,
    example: 49.9,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  priceMonthly?: number;

  @ApiPropertyOptional({
    description: 'A number in, a string out — same reason as priceMonthly.',
    minimum: 0,
    maximum: 1000000,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  priceYearly?: number;

  @ApiPropertyOptional({
    description: 'Exactly three characters. Not checked against ISO 4217 — "XXX" is accepted.',
    minLength: 3,
    maxLength: 3,
    example: 'USD',
  })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiPropertyOptional({ enum: Object.values(BillingInterval) })
  @IsOptional()
  @IsEnum(BillingInterval)
  billingInterval?: BillingInterval;

  @ApiPropertyOptional({ minimum: 0, maximum: 365, description: '0 means no trial.' })
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  @Max(365)
  trialDays?: number;

  @ApiPropertyOptional({ description: 'Inactive plans cannot take new subscriptions.' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Whether it appears on the public pricing endpoint.' })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiPropertyOptional({
    type: PlanLimitsDto,
    description:
      'Per-plan quotas. `{}` means the plan sets no limits, which reads as UNLIMITED rather ' +
      'than zero.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PlanLimitsDto)
  limits?: PlanLimitsDto;
}

/** Update a plan — every field optional; `code` is immutable. */
export class UpdatePlanDto extends PartialType(OmitType(CreatePlanDto, ['code'] as const)) {}

export class ListPlansQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}
