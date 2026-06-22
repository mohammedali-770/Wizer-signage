import { UserRole } from '@prisma/client';
import { IsArray, IsEmail, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateInvitationDto {
  @IsEmail()
  email!: string;

  @IsEnum(UserRole)
  role!: UserRole;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  /** Super Admin only: the target company for the invite. */
  @IsOptional()
  @IsString()
  companyId?: string;

  /** Optional location scope for LOCATION_MANAGER invitees. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  locationIds?: string[];
}
