import {
  EmergencyBroadcastStatus,
  EmergencyBroadcastType,
  ScheduleTargetType,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

/** A single broadcast target (screen / group / location / company-wide). */
export class EmergencyTargetDto {
  @IsEnum(ScheduleTargetType)
  targetType!: ScheduleTargetType;

  @IsString()
  @MaxLength(60)
  targetId!: string;
}

export class CreateEmergencyBroadcastDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsEnum(EmergencyBroadcastType)
  broadcastType!: EmergencyBroadcastType;

  /** TEXT body when broadcastType = TEXT. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  /** External URL when broadcastType = URL. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  contentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  playlistId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  priority?: number;

  @IsOptional()
  @IsDateString()
  startAt?: string;

  @IsOptional()
  @IsDateString()
  endAt?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => EmergencyTargetDto)
  targets?: EmergencyTargetDto[];
}

export class UpdateEmergencyBroadcastDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsEnum(EmergencyBroadcastType)
  broadcastType?: EmergencyBroadcastType;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  contentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  playlistId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  priority?: number;

  @IsOptional()
  @IsDateString()
  startAt?: string;

  @IsOptional()
  @IsDateString()
  endAt?: string;
}

/** Create + activate a text broadcast in one call. */
export class QuickTextBroadcastDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  priority?: number;

  @IsOptional()
  @IsDateString()
  endAt?: string;

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => EmergencyTargetDto)
  targets!: EmergencyTargetDto[];
}

export class ListEmergencyBroadcastsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(EmergencyBroadcastStatus)
  status?: EmergencyBroadcastStatus;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
