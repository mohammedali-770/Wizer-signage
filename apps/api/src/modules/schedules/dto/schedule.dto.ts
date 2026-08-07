import { ScheduleStatus, ScheduleTargetType, ScheduleType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class ScheduleTargetInputDto {
  @ApiProperty({ enum: Object.values(ScheduleTargetType) })
  @IsEnum(ScheduleTargetType)
  targetType!: ScheduleTargetType;

  /** Required for SCREEN/SCREEN_GROUP/LOCATION; ignored (defaults to companyId) for COMPANY. */
  @ApiPropertyOptional({
    description:
      'CONDITIONALLY REQUIRED — needed for SCREEN, SCREEN_GROUP and LOCATION, and ignored for ' +
      'COMPANY (which targets your own tenant). Optional in the schema because the requirement ' +
      'depends on targetType, which JSON Schema cannot express here.',
  })
  @IsOptional()
  @IsString()
  targetId?: string;
}

export class CreateScheduleDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    description:
      'Optional — a schedule may exist with no playlist, and validation reports it as not ' +
      'schedulable rather than refusing to create it.',
  })
  @IsOptional()
  @IsString()
  playlistId?: string;

  /** ACTIVE (default) or PAUSED. Archiving is done via the archive endpoint. */
  @ApiPropertyOptional({
    enum: [ScheduleStatus.ACTIVE, ScheduleStatus.PAUSED],
    description: 'NARROWER than the ScheduleStatus responses carry — ARCHIVED has its own route.',
  })
  @IsOptional()
  @IsIn([ScheduleStatus.ACTIVE, ScheduleStatus.PAUSED])
  status?: ScheduleStatus;

  @ApiPropertyOptional({ enum: Object.values(ScheduleType) })
  @IsOptional()
  @IsEnum(ScheduleType)
  scheduleType?: ScheduleType;

  /** Higher wins. CAMPAIGN breaks ties over NORMAL at equal priority. */
  @ApiPropertyOptional({
    description:
      'Higher wins. At EQUAL priority a CAMPAIGN beats a NORMAL schedule, so priority alone ' +
      'does not decide the winner — and when the rules cannot separate two schedules, conflict ' +
      'validation reports a null winnerId for a human to settle.',
    minimum: 0,
    maximum: 1000000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  priority?: number;

  @ApiProperty({
    format: 'date-time',
    description: 'REQUIRED — the only mandatory date. endDate omitted means it never expires.',
  })
  @IsDateString()
  startDate!: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({
    description: 'HH:mm, 24-hour, in the schedule timezone.',
    pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
    example: '09:00',
  })
  @IsOptional()
  @Matches(HH_MM, { message: 'startTime must be HH:mm (24h).' })
  startTime?: string;

  @ApiPropertyOptional({
    description:
      'HH:mm, 24-hour. An endTime EARLIER than startTime is not an error — it means an ' +
      'OVERNIGHT window that crosses midnight (22:00 to 02:00 runs four hours, not twenty).',
    pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
    example: '17:00',
  })
  @IsOptional()
  @Matches(HH_MM, { message: 'endTime must be HH:mm (24h). endTime < startTime means overnight.' })
  endTime?: string;

  @ApiPropertyOptional({ description: 'Ignores startTime/endTime when true.' })
  @IsOptional()
  @IsBoolean()
  isAllDay?: boolean;

  @ApiPropertyOptional({
    type: [Number],
    maxItems: 7,
    minimum: 0,
    maximum: 6,
    description:
      '0 = SUNDAY through 6 = Saturday (see common/scheduling/schedule-time.util.ts). Evaluated ' +
      'in the schedule timezone, not UTC. Omitted means every day. An off-by-one here plays ' +
      'content on the wrong day without any error.',
    example: [1, 2, 3, 4, 5],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek?: number[];

  @ApiPropertyOptional({
    description:
      'IANA zone the window is evaluated in. Falls back to the screen timezone when omitted. ' +
      'Length-checked only, not validated against the tz database.',
    maxLength: 60,
    example: 'Asia/Dubai',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  timezone?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'STORED AND ECHOED BACK, but never acted on: the resolver does not consult it, so a ' +
      'recurrence rule here changes nothing about what plays. Reserved for a future release.',
  })
  @IsOptional()
  @IsObject()
  recurrence?: Record<string, unknown>;

  @ApiPropertyOptional({
    type: [ScheduleTargetInputDto],
    maxItems: 200,
    description:
      'Where this schedule applies. A schedule with NO targets reaches no screens — validation ' +
      'reports targetCount 0 rather than refusing it.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ScheduleTargetInputDto)
  targets?: ScheduleTargetInputDto[];
}

/**
 * `targets` is absent: they are managed through the schedule-target endpoints,
 * so an update cannot replace where a schedule applies. Several fields accept
 * an explicit `null` to CLEAR them — omitting the field leaves it untouched,
 * which is a different thing.
 */
export class UpdateScheduleDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  /** Set a playlist, or null to detach. */
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Explicit null DETACHES the playlist; omitting the field leaves it as it is.',
  })
  @IsOptional()
  @IsString()
  playlistId?: string | null;

  @ApiPropertyOptional({ enum: [ScheduleStatus.ACTIVE, ScheduleStatus.PAUSED] })
  @IsOptional()
  @IsIn([ScheduleStatus.ACTIVE, ScheduleStatus.PAUSED])
  status?: ScheduleStatus;

  @ApiPropertyOptional({ enum: Object.values(ScheduleType) })
  @IsOptional()
  @IsEnum(ScheduleType)
  scheduleType?: ScheduleType;

  @ApiPropertyOptional({ minimum: 0, maximum: 1000000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  priority?: number;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'null CLEARS the end date, making the schedule open-ended.',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'null clears it.' })
  @IsOptional()
  @Matches(HH_MM, { message: 'startTime must be HH:mm (24h).' })
  startTime?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'null clears it. Earlier than startTime still means an overnight window.',
  })
  @IsOptional()
  @Matches(HH_MM, { message: 'endTime must be HH:mm (24h).' })
  endTime?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isAllDay?: boolean;

  @ApiPropertyOptional({
    type: [Number],
    maxItems: 7,
    minimum: 0,
    maximum: 6,
    description:
      '0 = SUNDAY through 6 = Saturday (see common/scheduling/schedule-time.util.ts). Evaluated ' +
      'in the schedule timezone, not UTC. Omitted means every day. An off-by-one here plays ' +
      'content on the wrong day without any error.',
    example: [1, 2, 3, 4, 5],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek?: number[];

  @ApiPropertyOptional({ maxLength: 60, example: 'Asia/Dubai' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  timezone?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'STORED AND ECHOED BACK, but never acted on: the resolver does not consult it, so a ' +
      'recurrence rule here changes nothing about what plays. Reserved for a future release.',
  })
  @IsOptional()
  @IsObject()
  recurrence?: Record<string, unknown>;
}

export class ListSchedulesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(ScheduleStatus)
  status?: ScheduleStatus;

  @IsOptional()
  @IsEnum(ScheduleType)
  scheduleType?: ScheduleType;

  @IsOptional()
  @IsEnum(ScheduleTargetType)
  targetType?: ScheduleTargetType;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsIn(['newest', 'oldest', 'name', 'priority', 'updated'])
  sort?: 'newest' | 'oldest' | 'name' | 'priority' | 'updated';
}

export class AddScheduleTargetDto extends ScheduleTargetInputDto {}

export class ManifestQueryDto {
  /** Evaluate "what plays" at this instant (ISO). Defaults to now. */
  @IsOptional()
  @IsDateString()
  at?: string;
}
