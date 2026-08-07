import { UserRole } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEmail, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateInvitationDto {
  @ApiProperty({ format: 'email', example: 'new.user@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({
    enum: Object.values(UserRole),
    description:
      'Required — an invitation always carries a role. As on user update, the enum is wider ' +
      'than any one caller may use: inviting a SUPER_ADMIN requires being one.',
  })
  @IsEnum(UserRole)
  role!: UserRole;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  /** Super Admin only: the target company for the invite. */
  @ApiPropertyOptional({
    description:
      'SUPER ADMIN ONLY, and the one field here that crosses a tenant boundary. For everyone ' +
      'else the company comes from the token and this is ignored — it is never trusted as the ' +
      'caller-supplied tenant (see docs/multi-tenancy.md).',
  })
  @IsOptional()
  @IsString()
  companyId?: string;

  /** Optional location scope for LOCATION_MANAGER invitees. */
  @ApiPropertyOptional({
    type: [String],
    description:
      'Scopes a LOCATION_MANAGER to these locations. Meaningless for other roles, and not ' +
      'rejected for them — it is simply unused.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  locationIds?: string[];
}
