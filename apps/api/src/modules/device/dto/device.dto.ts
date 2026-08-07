import { SyncStatus } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/** Device → backend: begin pairing. The device supplies a stable self-generated id. */
export class StartPairingDto {
  @IsString()
  @MaxLength(120)
  deviceId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  platform?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  modelName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  osVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  appVersion?: string;
}

/** Device → backend: poll pairing status (the private secret travels in a header). */
export class PairingStatusQueryDto {
  @IsString()
  @MaxLength(32)
  code!: string;
}

/** Dashboard → backend: bind a pairing code to this screen. */
export class PairScreenDto {
  @ApiProperty({
    description:
      'The code shown on the screen. Short-lived and single-use: it is consumed on success, so ' +
      'pairing the same code twice fails even though the first call worked.',
    maxLength: 32,
    example: 'K7Q2-9XTM',
  })
  @IsString()
  @MaxLength(32)
  pairingCode!: string;
}

/** Device → backend: report the latest offline-cache / smart-sync status (Phase 7). */
export class ReportSyncStatusDto {
  @IsEnum(SyncStatus)
  status!: SyncStatus;

  @IsOptional()
  @IsIn(['REMOTE', 'LOCAL_CACHE'])
  manifestSource?: 'REMOTE' | 'LOCAL_CACHE';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  manifestVersion?: string;

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
  @IsInt()
  @Min(0)
  cacheSizeBytes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  availableStorageBytes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  lastError?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(500)
  failedAssetIds?: string[];
}
