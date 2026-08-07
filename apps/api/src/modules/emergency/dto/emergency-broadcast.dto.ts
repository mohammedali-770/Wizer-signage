import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

/** A single broadcast target (screen / group / location / company-wide). */
/**
 * Compare `ScheduleTargetInputDto`, which models the same idea and disagrees:
 * there `targetId` is OPTIONAL (ignored for COMPANY targets) and unbounded;
 * here it is REQUIRED and capped at 60. A client cannot share one target type
 * across schedules and emergency broadcasts.
 */
export class EmergencyTargetDto {
  @ApiProperty({ enum: Object.values(ScheduleTargetType) })
  @IsEnum(ScheduleTargetType)
  targetType!: ScheduleTargetType;

  @ApiProperty({
    description:
      'REQUIRED here, including for COMPANY targets — unlike the schedule equivalent, where it ' +
      'is optional and defaults to your own company.',
    maxLength: 60,
  })
  @IsString()
  @MaxLength(60)
  targetId!: string;
}

/**
 * An emergency broadcast PRE-EMPTS everything — schedules, fallback, and
 * working hours — so the four payload fields below are conditionally required
 * by `broadcastType` and the schema cannot say which. Creating one does not
 * activate it: it starts as DRAFT and needs the activate endpoint.
 */
export class CreateEmergencyBroadcastDto {
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({
    enum: Object.values(EmergencyBroadcastType),
    description: 'Decides which of message / url / contentId / playlistId is required.',
  })
  @IsEnum(EmergencyBroadcastType)
  broadcastType!: EmergencyBroadcastType;

  /** TEXT body when broadcastType = TEXT. */
  @ApiPropertyOptional({
    description: 'Required when broadcastType is TEXT; ignored otherwise.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  /** External URL when broadcastType = URL. */
  @ApiPropertyOptional({
    description:
      'Required when broadcastType is URL. An absolute http(s) URL — the protocol is REQUIRED, ' +
      'matching `CreateUrlContentDto.url`. Previously any string was accepted here, so a ' +
      'protocol-less value passed validation and then failed on every screen mid-emergency.',
    format: 'uri',
    maxLength: 2000,
    example: 'https://example.com/alert',
  })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(2000)
  url?: string;

  @ApiPropertyOptional({
    description: 'Required when broadcastType is CONTENT.',
    maxLength: 60,
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  contentId?: string;

  @ApiPropertyOptional({
    description: 'Required when broadcastType is PLAYLIST.',
    maxLength: 60,
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  playlistId?: string;

  @ApiPropertyOptional({
    description:
      'Ranks this against OTHER emergency broadcasts only — every emergency already outranks ' +
      'every schedule. Note the cap is 100000 here, where schedules allow 1000000.',
    minimum: 0,
    maximum: 100000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  priority?: number;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  startAt?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'The maintenance sweep auto-ENDs a broadcast once this passes.',
  })
  @IsOptional()
  @IsDateString()
  endAt?: string;

  @ApiPropertyOptional({
    type: [EmergencyTargetDto],
    maxItems: 200,
    description: 'A broadcast reaching no screens is reported invalid by validation.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => EmergencyTargetDto)
  targets?: EmergencyTargetDto[];
}

/**
 * `targets` is absent — audience is managed through the target endpoints, so an
 * update cannot silently widen who a live emergency reaches.
 */
export class UpdateEmergencyBroadcastDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    enum: Object.values(EmergencyBroadcastType),
    description: 'Changing it changes which payload field is required.',
  })
  @IsOptional()
  @IsEnum(EmergencyBroadcastType)
  broadcastType?: EmergencyBroadcastType;

  @ApiPropertyOptional({ maxLength: 2000, description: 'For TEXT broadcasts.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @ApiPropertyOptional({
    maxLength: 2000,
    format: 'uri',
    description: 'For URL broadcasts. Absolute http(s), protocol required — as on create.',
  })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(2000)
  url?: string;

  @ApiPropertyOptional({ maxLength: 60, description: 'For CONTENT broadcasts.' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  contentId?: string;

  @ApiPropertyOptional({ maxLength: 60, description: 'For PLAYLIST broadcasts.' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  playlistId?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 100000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  priority?: number;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  startAt?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  endAt?: string;
}

/** Create + activate a text broadcast in one call. */
/**
 * Creates AND ACTIVATES in one call, unlike the normal create which lands in
 * DRAFT. So this is the one route where a single request pre-empts playback on
 * every targeted screen immediately — there is no review step.
 */
export class QuickTextBroadcastDto {
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiProperty({
    minLength: 1,
    maxLength: 2000,
    description: 'The text shown on every targeted screen.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 100000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  priority?: number;

  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'Auto-ENDed by the maintenance sweep once passed. With no endAt it runs until ended by hand.',
  })
  @IsOptional()
  @IsDateString()
  endAt?: string;

  @ApiProperty({
    type: [EmergencyTargetDto],
    description: 'REQUIRED here — an instant broadcast with no audience is refused.',
  })
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
