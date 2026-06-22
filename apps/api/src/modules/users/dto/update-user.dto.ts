import { UserRole, UserStatus } from '@prisma/client';
import { IsArray, IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsBoolean()
  twoFactorEnforced?: boolean;

  /** Assigned locations (for LOCATION_MANAGER). Replaces the current set. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  locationIds?: string[];
}
