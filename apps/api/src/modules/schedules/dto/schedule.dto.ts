import { ScheduleStatus, ScheduleTargetType, ScheduleType } from '@prisma/client';
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
  @IsEnum(ScheduleTargetType)
  targetType!: ScheduleTargetType;

  /** Required for SCREEN/SCREEN_GROUP/LOCATION; ignored (defaults to companyId) for COMPANY. */
  @IsOptional()
  @IsString()
  targetId?: string;
}

export class CreateScheduleDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  playlistId?: string;

  /** ACTIVE (default) or PAUSED. Archiving is done via the archive endpoint. */
  @IsOptional()
  @IsIn([ScheduleStatus.ACTIVE, ScheduleStatus.PAUSED])
  status?: ScheduleStatus;

  @IsOptional()
  @IsEnum(ScheduleType)
  scheduleType?: ScheduleType;

  /** Higher wins. CAMPAIGN breaks ties over NORMAL at equal priority. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  priority?: number;

  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @Matches(HH_MM, { message: 'startTime must be HH:mm (24h).' })
  startTime?: string;

  @IsOptional()
  @Matches(HH_MM, { message: 'endTime must be HH:mm (24h). endTime < startTime means overnight.' })
  endTime?: string;

  @IsOptional()
  @IsBoolean()
  isAllDay?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek?: number[];

  @IsOptional()
  @IsString()
  @MaxLength(60)
  timezone?: string;

  @IsOptional()
  @IsObject()
  recurrence?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ScheduleTargetInputDto)
  targets?: ScheduleTargetInputDto[];
}

export class UpdateScheduleDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  /** Set a playlist, or null to detach. */
  @IsOptional()
  @IsString()
  playlistId?: string | null;

  @IsOptional()
  @IsIn([ScheduleStatus.ACTIVE, ScheduleStatus.PAUSED])
  status?: ScheduleStatus;

  @IsOptional()
  @IsEnum(ScheduleType)
  scheduleType?: ScheduleType;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  priority?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @IsOptional()
  @Matches(HH_MM, { message: 'startTime must be HH:mm (24h).' })
  startTime?: string | null;

  @IsOptional()
  @Matches(HH_MM, { message: 'endTime must be HH:mm (24h).' })
  endTime?: string | null;

  @IsOptional()
  @IsBoolean()
  isAllDay?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek?: number[];

  @IsOptional()
  @IsString()
  @MaxLength(60)
  timezone?: string;

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
