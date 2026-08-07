import { CompanyStatus } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

/**
 * A plaintext kiosk PIN, hashed server-side.
 *
 * It is never returned: the company-settings response substitutes a
 * `hasDefaultKioskPin` boolean, the same trade `ScreenDto.hasKioskPin` makes.
 * So this is write-only in practice, and a client cannot read back what it set.
 */
const KIOSK_PIN = {
  description:
    'Plaintext 4-8 digit PIN. Hashed on receipt and never returned — responses expose only ' +
    '`hasDefaultKioskPin`, so this cannot be read back.',
  pattern: '^\\d{4,8}$',
  example: '4821',
} as const;

/**
 * NOTE the field sets of Create and Update deliberately DIFFER, and this class
 * is hand-written rather than a `PartialType` of the other so they can.
 *
 *   create only:  slug, planId
 *   update only:  brandedEmailFrom, customDomain
 *
 * The consequence for a client: a company cannot be created with a custom
 * domain or branded sender in one call — those need a follow-up update. And the
 * slug, which is the tenant's identity in URLs, is fixed at creation.
 */
export class CreateCompanyDto {
  @ApiProperty({ maxLength: 120, example: 'Acme Retail' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({
    description:
      'The tenant identifier used in URLs. Lowercase letters, digits and hyphens only. ' +
      'Derived from the name when omitted, and the allocated value may differ from what was ' +
      'asked for if it collides. CREATE-ONLY — there is no field for it on update.',
    maxLength: 60,
    pattern: '^[a-z0-9-]+$',
    example: 'acme-retail',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Matches(/^[a-z0-9-]+$/, { message: 'slug must be lowercase letters, digits, or hyphens.' })
  slug?: string;

  @ApiPropertyOptional({ minLength: 2, maxLength: 10, example: 'en' })
  @IsOptional()
  @IsString()
  @Length(2, 10)
  defaultLocale?: string;

  @ApiPropertyOptional({
    description: 'IANA zone name. Length-checked only, not validated against the tz database.',
    maxLength: 60,
    example: 'Asia/Dubai',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  timezone?: string;

  /** Optional initial plan — creates a trialing subscription. */
  @ApiPropertyOptional({
    description:
      'Starts a TRIALING subscription on this plan. CREATE-ONLY: changing plan later goes ' +
      'through the subscriptions endpoints, not through a company update.',
  })
  @IsOptional()
  @IsString()
  planId?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;

  @ApiPropertyOptional({
    description:
      'Free-form, capped at 20 characters and NOT pattern-checked — unlike `CreateTagDto.color`, ' +
      'which demands a hex value. Same kind of field, two different rules; anything short enough ' +
      'is accepted here.',
    maxLength: 20,
    example: '#2563eb',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  primaryColor?: string;

  @ApiPropertyOptional(KIOSK_PIN)
  @IsOptional()
  @IsString()
  @Matches(/^\d{4,8}$/, { message: 'defaultKioskPin must be 4-8 digits.' })
  defaultKioskPin?: string;
}

/** See the note on {@link CreateCompanyDto} for why the field sets differ. */
export class UpdateCompanyDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ minLength: 2, maxLength: 10, example: 'en' })
  @IsOptional()
  @IsString()
  @Length(2, 10)
  defaultLocale?: string;

  @ApiPropertyOptional({ maxLength: 60, example: 'Asia/Dubai' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  timezone?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;

  @ApiPropertyOptional({ maxLength: 20, description: 'Not pattern-checked — see the create DTO.' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  primaryColor?: string;

  @ApiPropertyOptional({
    description: 'UPDATE-ONLY — cannot be supplied at creation.',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  brandedEmailFrom?: string;

  @ApiPropertyOptional({
    description: 'UPDATE-ONLY — cannot be supplied at creation.',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  customDomain?: string;

  @ApiPropertyOptional(KIOSK_PIN)
  @IsOptional()
  @IsString()
  @Matches(/^\d{4,8}$/, { message: 'defaultKioskPin must be 4-8 digits.' })
  defaultKioskPin?: string;
}

export class ListCompaniesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(CompanyStatus)
  status?: CompanyStatus;

  @IsOptional()
  @IsIn(['createdAt', 'name'])
  sort?: 'createdAt' | 'name';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

export class SuspendCompanyDto {
  @ApiPropertyOptional({
    description:
      'Recorded on the company and in the activity log. Optional — a suspension with no stated ' +
      'reason is accepted, so the body itself may be empty.',
    maxLength: 300,
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
