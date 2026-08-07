import { UserRole, UserStatus } from '@prisma/client';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * The enums here are WIDER than what a given caller may actually send.
 *
 * `@IsEnum` admits every value; authority is decided afterwards in
 * `users.service.ts` — only a Super Admin may grant or remove SUPER_ADMIN, and
 * the last active one cannot be demoted or disabled. So a value listed below
 * can still come back 403, and the schema alone will not tell a client which.
 * Publishing the narrow set instead would be worse: it would be wrong for Super
 * Admins, for whom the wide set is real.
 */
export class UpdateUserDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ maxLength: 10, example: 'en' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  @ApiPropertyOptional({
    enum: Object.values(UserRole),
    description:
      'Granting or removing SUPER_ADMIN requires the caller to BE a Super Admin, and demoting ' +
      'the last active one is refused outright — both enforced in the service, not here.',
  })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({
    enum: Object.values(UserStatus),
    description:
      'Setting a status other than ACTIVE goes through the same authority check as a role ' +
      'change, so this is not a back door to disabling an account you could not demote.',
  })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({
    description: 'Makes 2FA mandatory for this user, as it always is for a Super Admin.',
  })
  @IsOptional()
  @IsBoolean()
  twoFactorEnforced?: boolean;

  /** Assigned locations (for LOCATION_MANAGER). Replaces the current set. */
  @ApiPropertyOptional({
    type: [String],
    description:
      'REPLACES the assigned set — it does not add to it. Sending one id leaves the user with ' +
      'exactly that location, and `[]` removes every assignment. Omit the field to leave the ' +
      'current set alone; the two are NOT the same thing.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  locationIds?: string[];
}
