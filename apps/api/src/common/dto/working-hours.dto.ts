import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Behaviour when a screen is outside its active hours (executed device-side later). */
export enum OutsideHoursBehavior {
  FALLBACK = 'FALLBACK',
  BLACK_SCREEN = 'BLACK_SCREEN',
  CUSTOM_MESSAGE = 'CUSTOM_MESSAGE',
  SLEEP = 'SLEEP',
}

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class DayHoursDto {
  /** 0 = Sunday … 6 = Saturday. */
  @IsInt()
  @Min(0)
  @Max(6)
  day!: number;

  @IsBoolean()
  closed!: boolean;

  @IsOptional()
  @Matches(HH_MM, { message: 'open must be HH:mm (24h).' })
  open?: string;

  @IsOptional()
  @Matches(HH_MM, { message: 'close must be HH:mm (24h). Overnight (close < open) is allowed.' })
  close?: string;
}

/**
 * Working / active hours configuration. Persisted as JSON on Location, Screen,
 * and Company.settings. Timezone defaults to the entity's own timezone.
 * Configuration only in Phase 3 — Android playback execution comes later.
 */
export class WorkingHoursDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  timezone?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => DayHoursDto)
  days?: DayHoursDto[];

  @IsOptional()
  @IsEnum(OutsideHoursBehavior)
  outsideHoursBehavior?: OutsideHoursBehavior;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  outsideHoursMessage?: string;
}
