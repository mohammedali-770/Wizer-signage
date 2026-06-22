import {
  ContentType,
  PlaybackSourceKind,
  PlaybackSourceType,
  ProofOfPlayStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { MAX_EVENTS_PER_BATCH } from '../proof-of-play.constants';

export const PROOF_OF_PLAY_EVENT_TYPES = [
  'ITEM_STARTED',
  'ITEM_COMPLETED',
  'ITEM_FAILED',
  'ITEM_SKIPPED',
  'ITEM_INTERRUPTED',
] as const;

/**
 * One actual player playback event (Phase 9). The device generates a
 * `playbackSessionId` per item playback; ITEM_STARTED opens the session and a
 * single terminal event (COMPLETED/FAILED/SKIPPED/INTERRUPTED) closes it.
 * Tenancy (company/screen/device) is NEVER taken from this payload — it is
 * derived server-side from the device token.
 */
export class ProofOfPlayEventDto {
  @IsIn(PROOF_OF_PLAY_EVENT_TYPES)
  eventType!: (typeof PROOF_OF_PLAY_EVENT_TYPES)[number];

  /** Idempotency key — unique per item playback. */
  @IsString()
  @MaxLength(80)
  playbackSessionId!: string;

  @IsDateString()
  startedAt!: string;

  @IsOptional()
  @IsDateString()
  endedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  contentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  playlistId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  playlistItemId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  scheduleId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  emergencyBroadcastId?: string;

  @IsOptional()
  @IsEnum(PlaybackSourceType)
  sourceType?: PlaybackSourceType;

  @IsOptional()
  @IsEnum(PlaybackSourceKind)
  playbackSource?: PlaybackSourceKind;

  @IsOptional()
  @IsEnum(ContentType)
  contentType?: ContentType;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationMs?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  expectedDurationMs?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  itemSequence?: number;

  @IsOptional()
  @IsBoolean()
  offlinePlayback?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  manifestVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  failureReason?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

/** Device → backend: a batch of proof-of-play events (one online or flushed-offline push). */
export class ReportProofOfPlayDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_EVENTS_PER_BATCH)
  @ValidateNested({ each: true })
  @Type(() => ProofOfPlayEventDto)
  events!: ProofOfPlayEventDto[];
}

/** Dashboard → backend: proof-of-play report filters. */
export class ProofOfPlayQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  screenId?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  contentId?: string;

  @IsOptional()
  @IsString()
  playlistId?: string;

  @IsOptional()
  @IsString()
  scheduleId?: string;

  @IsOptional()
  @IsString()
  emergencyBroadcastId?: string;

  @IsOptional()
  @IsEnum(ProofOfPlayStatus)
  status?: ProofOfPlayStatus;

  @IsOptional()
  @IsEnum(PlaybackSourceType)
  sourceType?: PlaybackSourceType;

  @IsOptional()
  @IsEnum(PlaybackSourceKind)
  playbackSource?: PlaybackSourceKind;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  offlineOnly?: boolean;
}
