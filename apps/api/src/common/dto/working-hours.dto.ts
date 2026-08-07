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

/**
 * Behaviour when a screen is outside its active hours.
 *
 * Split across two places, which is worth knowing before changing either:
 * FALLBACK is resolved SERVER-side — the resolver swaps in fallback content and
 * the manifest looks like an ordinary playing manifest. The other three are
 * carried on the manifest as `outsideHours` + `outsideHoursBehavior` and
 * executed DEVICE-side by `NoContentScreen` in the player.
 *
 * `SLEEP` does NOT power the panel down. The player renders it exactly like
 * BLACK_SCREEN — a black composable at full backlight — because nothing calls
 * `PowerManager`, and soft kiosk actively holds `FLAG_KEEP_SCREEN_ON` while it
 * is on. Real display sleep needs device-owner/MDM control the app does not
 * have. The value is kept because the API accepts and stores it, but an
 * operator choosing it should not expect the screen to switch off.
 */
export enum OutsideHoursBehavior {
  FALLBACK = 'FALLBACK',
  BLACK_SCREEN = 'BLACK_SCREEN',
  CUSTOM_MESSAGE = 'CUSTOM_MESSAGE',
  /** Renders black; does not power off the display. See the note above. */
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
 *
 * This is enforced end to end, not just stored: `schedule-resolver.service.ts`
 * evaluates it ahead of schedule targeting and stamps `outsideHours` /
 * `outsideHoursBehavior` onto the manifest, and the player acts on them. The
 * most specific configuration wins — screen, then location, then company.
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
