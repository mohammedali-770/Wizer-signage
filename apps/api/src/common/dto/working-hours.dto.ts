import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
 * THREE VALUES, NOT FOUR. `SLEEP` was renamed to `BLANK_SCREEN` for honesty —
 * it never powered the panel down and could not, because nothing calls
 * `PowerManager` and soft kiosk actively holds `FLAG_KEEP_SCREEN_ON`. But that
 * left `BLANK_SCREEN` and `BLACK_SCREEN` sitting one letter apart doing exactly
 * the same thing, which is its own trap: an operator picking between them is
 * being asked a question with no answer, and a reader cannot tell them apart.
 *
 * `BLACK_SCREEN` is the survivor. It predates the others, it holds by far the
 * most stored configuration, and it has never been renamed — so keeping it
 * costs no compatibility and describes what actually renders.
 *
 * LEGACY VALUES: `"SLEEP"` and `"BLANK_SCREEN"` are both still accepted on read
 * and map to `BLACK_SCREEN`. Working hours live in a JSON column, so no
 * migration has ever rewritten a stored value and both strings are still on
 * disk. Dropping either would send those rows through the `FALLBACK` default
 * and a venue that went dark outside opening hours would quietly start showing
 * fallback content instead. See `normalizeBehavior` in `working-hours.util.ts`.
 */
export enum OutsideHoursBehavior {
  FALLBACK = 'FALLBACK',
  BLACK_SCREEN = 'BLACK_SCREEN',
  CUSTOM_MESSAGE = 'CUSTOM_MESSAGE',
}

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class DayHoursDto {
  @ApiProperty({ minimum: 0, maximum: 6, description: '0 = Sunday … 6 = Saturday.', example: 1 })
  @IsInt()
  @Min(0)
  @Max(6)
  day!: number;

  @ApiProperty({ description: 'When true, open/close are ignored and the day is outside hours.' })
  @IsBoolean()
  closed!: boolean;

  @ApiPropertyOptional({
    pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
    description: '24h HH:mm. Omitted together with `close` means all-day open.',
    example: '09:00',
  })
  @IsOptional()
  @Matches(HH_MM, { message: 'open must be HH:mm (24h).' })
  open?: string;

  @ApiPropertyOptional({
    pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
    description: '24h HH:mm. OVERNIGHT IS ALLOWED — a close earlier than open crosses midnight.',
    example: '21:00',
  })
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
  @ApiPropertyOptional({
    maxLength: 60,
    description: "IANA zone. Defaults to the entity's own timezone when omitted.",
    example: 'Asia/Riyadh',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  timezone?: string;

  @ApiPropertyOptional({
    type: [DayHoursDto],
    maxItems: 7,
    description:
      'At most one entry per weekday. An ABSENT day counts as outside hours, so a partial ' +
      'array is not the same as an unset one: omitting `days` entirely means always on (24/7).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => DayHoursDto)
  days?: DayHoursDto[];

  @ApiPropertyOptional({
    enum: Object.values(OutsideHoursBehavior),
    description:
      'Defaults to FALLBACK when omitted or unrecognised. The legacy values "SLEEP" and ' +
      '"BLANK_SCREEN" are both still ACCEPTED and treated as BLACK_SCREEN; neither is listed ' +
      'here because neither should be sent by new callers. They rendered black anyway — SLEEP ' +
      'never slept the display, and BLANK_SCREEN was an exact duplicate of BLACK_SCREEN.',
  })
  @IsOptional()
  @IsEnum(OutsideHoursBehavior)
  outsideHoursBehavior?: OutsideHoursBehavior;

  @ApiPropertyOptional({
    maxLength: 280,
    description: 'Shown on the screen only when outsideHoursBehavior is CUSTOM_MESSAGE.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  outsideHoursMessage?: string;
}
