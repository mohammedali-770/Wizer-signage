import { BackupStatus, BackupType } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export const MAINTENANCE_JOBS = [
  'all',
  'sweep',
  'retention',
  'reports',
  'emergencies',
  'backup-check',
] as const;

export class RunMaintenanceDto {
  @IsOptional()
  @IsEnum(MAINTENANCE_JOBS)
  job?: (typeof MAINTENANCE_JOBS)[number];
}

export class RecordBackupDto {
  @IsEnum(BackupType)
  type!: BackupType;

  @IsEnum(BackupStatus)
  status!: BackupStatus;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sizeBytes?: number;

  @IsOptional()
  @IsString()
  error?: string;
}
