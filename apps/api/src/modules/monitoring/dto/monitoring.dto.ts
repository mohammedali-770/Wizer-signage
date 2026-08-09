import { DeviceCommandStatus, DeviceCommandType, SyncStatus } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

const PLAYBACK_STATES = ['PLAYING', 'IDLE', 'BUFFERING', 'ERROR', 'OFFLINE_PLAYBACK'] as const;
const NETWORK_STATES = ['ONLINE', 'OFFLINE', 'METERED'] as const;

/** Device → backend: a heartbeat with telemetry + a cache/sync summary (Phase 8). */
export class HeartbeatDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  appVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  osVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  platform?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  uptimeSeconds?: number;

  @IsOptional()
  @IsIn(PLAYBACK_STATES)
  playbackState?: (typeof PLAYBACK_STATES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(60)
  currentContentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  currentPlaylistId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  currentScheduleId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  manifestVersion?: string;

  @IsOptional()
  @IsIn(NETWORK_STATES)
  networkStatus?: (typeof NETWORK_STATES)[number];

  @IsOptional()
  @IsEnum(SyncStatus)
  syncStatus?: SyncStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  cacheSizeBytes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  availableStorageBytes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  requiredAssets?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  cachedAssets?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  failedDownloads?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  lastError?: string;

  /** Previous-run crash metadata. The Android stack trace is never uploaded. */
  @IsOptional()
  @IsInt()
  @Min(0)
  lastCrashAtMillis?: number;

  @IsOptional()
  @Matches(/^[a-f0-9]{24}$/)
  lastCrashFingerprint?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  crashCount?: number;

  /** Best-effort device capability flags, e.g. { screenshot, reboot, kiosk, autoStart }. */
  @IsOptional()
  @IsObject()
  capabilities?: Record<string, unknown>;
}

/** Dashboard → backend: issue a remote command. */
export class IssueCommandDto {
  @ApiProperty({
    enum: Object.values(DeviceCommandType),
    description:
      'Queued for POLLING pickup, not pushed — the screen collects it on its next heartbeat, so ' +
      'a 2xx here means "accepted", never "done". REBOOT is accepted and then reported ' +
      'unsupported by most consumer TVs.',
  })
  @IsEnum(DeviceCommandType)
  commandType!: DeviceCommandType;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'OPAQUE and command-specific. Checked only for being an object — no key is required or ' +
      'validated against commandType, so a payload the command does not understand is queued ' +
      'and ignored rather than rejected.',
  })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

/** Device → backend: report a command's outcome. */
export class CommandResultDto {
  @IsIn([DeviceCommandStatus.SUCCEEDED, DeviceCommandStatus.FAILED])
  status!: DeviceCommandStatus;

  @IsOptional()
  @IsObject()
  result?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  error?: string;
}

/** Device → backend: metadata accompanying a screenshot upload (file sent separately). */
export class ScreenshotUploadDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  commandId?: string;

  @IsOptional()
  @IsDateString()
  capturedAt?: string;

  @IsOptional()
  @IsIn(['AUTO', 'MANUAL'])
  type?: 'AUTO' | 'MANUAL';
}

export class ListCommandsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(DeviceCommandStatus)
  status?: DeviceCommandStatus;
}
