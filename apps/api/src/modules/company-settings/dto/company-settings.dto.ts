import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
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
