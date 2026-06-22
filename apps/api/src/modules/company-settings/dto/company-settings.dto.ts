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

export class UpdateCompanySettingsDto {
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
  @ValidateNested()
  @Type(() => WorkingHoursDto)
  defaultWorkingHours?: WorkingHoursDto;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(3600)
  defaultHeartbeatIntervalSeconds?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsEmail({}, { each: true })
  notificationEmails?: string[];

  /** Placeholder reference — Content selection connects in Phase 4. */
  @IsOptional()
  @IsString()
  fallbackContentId?: string;
}

export class SetDefaultKioskPinDto {
  @Matches(/^\d{4,8}$/, { message: 'pin must be 4-8 digits.' })
  pin!: string;
}
