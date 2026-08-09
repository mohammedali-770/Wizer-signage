import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiPropertyOptional({
    enum: MAINTENANCE_JOBS,
    description:
      'Which sweep to run. Omitted runs them ALL — so an empty body is not a no-op, it is the ' +
      'most expensive call this endpoint offers.',
  })
  @IsOptional()
  @IsEnum(MAINTENANCE_JOBS)
  job?: (typeof MAINTENANCE_JOBS)[number];
}

/**
 * Records that a backup HAPPENED — it does not take one. The dump is made by
 * `scripts/backup-db.sh`, which calls this afterwards, so a row here is a claim
 * by the caller rather than something the API verified.
 */
export class RecordBackupDto {
  @ApiProperty({ enum: Object.values(BackupType) })
  @IsEnum(BackupType)
  type!: BackupType;

  @ApiProperty({
    enum: Object.values(BackupStatus),
    description: 'A FAILED record is the point of the endpoint — it is what raises the alert.',
  })
  @IsEnum(BackupStatus)
  status!: BackupStatus;

  @ApiPropertyOptional({
    description:
      'Where the dump was written. Free-form and unvalidated; nothing checks the file exists.',
  })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ minimum: 0, description: 'Size of the dump in bytes.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sizeBytes?: number;

  @ApiPropertyOptional({ description: 'Failure detail. Meaningful only when status is FAILED.' })
  @IsOptional()
  @IsString()
  error?: string;
}
