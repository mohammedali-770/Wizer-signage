import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { WorkingHoursDto } from '../../../common/dto/working-hours.dto';

/**
 * The company-facing subset of what a Super Admin can change.
 *
 * Overlaps `UpdateCompanyDto` on name/locale/timezone but is NOT the same body:
 * no branding, no custom domain, and it adds the fleet defaults below. A client
 * cannot share one type across the two endpoints.
 */
export class UpdateCompanySettingsDto {
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

  @ApiPropertyOptional({
    type: WorkingHoursDto,
    description: 'The company-wide default. A location or screen may override it.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => WorkingHoursDto)
  defaultWorkingHours?: WorkingHoursDto;

  @ApiPropertyOptional({
    description:
      'How often a screen reports in. Read back as 60 when never set, so the response never ' +
      'shows null even though nothing was written — do not infer "unset" from the GET.',
    minimum: 10,
    maximum: 3600,
    example: 60,
  })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(3600)
  defaultHeartbeatIntervalSeconds?: number;

  @ApiPropertyOptional({
    type: [String],
    maxItems: 10,
    description:
      'REPLACES the list — send the full set, not an addition. Every entry must be a valid ' +
      'address; one bad entry rejects the whole array. Read back as [] when never set.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsEmail({}, { each: true })
  notificationEmails?: string[];

  @ApiPropertyOptional({
    description: 'Company-wide fallback content. Existence and ownership are checked server-side.',
  })
  @IsOptional()
  @IsString()
  fallbackContentId?: string;
}

/**
 * Replaces the entire Android OTA rollout policy for one company. Publishing a
 * binary never changes this policy; operators explicitly pin a target version.
 */
export class AndroidOtaSettingsDto {
  @ApiProperty({ description: 'Emergency master switch. false halts new installs immediately.' })
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional({
    minimum: 1,
    description: 'Exact published versionCode allowed to install. Required when enabled=true.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  targetVersionCode?: number;

  @ApiProperty({ minimum: 0, maximum: 100, description: 'Stable deterministic fleet cohort percentage.' })
  @IsInt()
  @Min(0)
  @Max(100)
  rolloutPercent!: number;

  @ApiPropertyOptional({
    type: [String],
    maxItems: 200,
    description: 'Explicit same-company screen canaries. Eligible regardless of rolloutPercent.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  screenIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    maxItems: 100,
    description: 'Explicit same-company screen-group canaries. Eligible regardless of rolloutPercent.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  groupIds?: string[];

  @ApiPropertyOptional({ minimum: 900, maximum: 86400, default: 21600 })
  @IsOptional()
  @IsInt()
  @Min(900)
  @Max(86_400)
  checkIntervalSeconds?: number;
}

export class SetDefaultKioskPinDto {
  @ApiProperty({
    description:
      'Plaintext 4-8 digit PIN, hashed on receipt. Never returned: the settings response ' +
      'exposes only `hasDefaultKioskPin`, so this cannot be read back to check it.',
    pattern: '^\\d{4,8}$',
    example: '4821',
  })
  @Matches(/^\d{4,8}$/, { message: 'pin must be 4-8 digits.' })
  pin!: string;
}
