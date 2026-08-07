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
 * `BLANK_SCREEN` was called `SLEEP` until it was renamed for honesty: it never
 * powered the panel down and could not. The player renders it exactly like
 * BLACK_SCREEN — a black composable at full backlight — because nothing calls
 * `PowerManager`, and soft kiosk actively holds `FLAG_KEEP_SCREEN_ON` while it
 * is on. Real display sleep needs device-owner/MDM control the app does not
 * have, so the old name promised hardware behaviour that no code delivered.
 *
 * LEGACY VALUES: `"SLEEP"` is still accepted on read. It is stored in JSON on
 * Location/Screen/Company rows, so existing configurations still carry it and
 * there is no migration to rewrite them; `normalizeBehavior` maps it to
 * `BLANK_SCREEN` (see `working-hours.util.ts`). Without that mapping the value
 * would fall through to `FALLBACK` and every already-configured screen would
 * quietly start showing fallback content instead of going dark.
 */
export enum OutsideHoursBehavior {
  FALLBACK = 'FALLBACK',
  BLACK_SCREEN = 'BLACK_SCREEN',
  CUSTOM_MESSAGE = 'CUSTOM_MESSAGE',
  /**
   * Renders black. Identical in effect to {@link BLACK_SCREEN} — the two are
   * kept separate only because both are already stored in customer data.
   */
  BLANK_SCREEN = 'BLANK_SCREEN',
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
      'Defaults to FALLBACK when omitted or unrecognised. The legacy value "SLEEP" is still ' +
      'ACCEPTED and treated as BLANK_SCREEN, but is not listed here because it should not be ' +
      'sent by new callers — it never slept the display.',
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
