import { CompanyStatus } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class CreateCompanyDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Matches(/^[a-z0-9-]+$/, { message: 'slug must be lowercase letters, digits, or hyphens.' })
  slug?: string;

  @IsOptional()
  @IsString()
  @Length(2, 10)
  defaultLocale?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  timezone?: string;

  /** Optional initial plan — creates a trialing subscription. */
  @IsOptional()
  @IsString()
  planId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  primaryColor?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4,8}$/, { message: 'defaultKioskPin must be 4-8 digits.' })
  defaultKioskPin?: string;
}

export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(2, 10)
  defaultLocale?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  primaryColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  brandedEmailFrom?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  customDomain?: string;

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
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
