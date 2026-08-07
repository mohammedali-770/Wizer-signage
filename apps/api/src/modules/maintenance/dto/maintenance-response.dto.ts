import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** One recorded backup run. */
export class BackupRunDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'What was backed up, e.g. DATABASE.' })
  type!: string;

  @ApiProperty({ enum: ['SUCCESS', 'FAILED'] })
  status!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Where it was written. A path or bucket key, not a credential.',
  })
  location?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Serialised as a string — a 64-bit column, not a JSON number.',
  })
  sizeBytes?: string | null;

  @ApiProperty({ format: 'date-time' })
  startedAt!: string;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  finishedAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  error?: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

/** GET /admin/backups — the answer to "are we actually backed up?". */
export class BackupStatusDto {
  @ApiPropertyOptional({
    nullable: true,
    format: 'date-time',
    description: 'null means NO successful database backup has ever been recorded.',
  })
  lastSuccessfulDatabaseBackupAt?: string | null;

  @ApiProperty({
    description:
      'True when the last success is older than the threshold — OR when there has never been ' +
      'one. Both are the same alert, and a client reading only the timestamp misses the second.',
  })
  stale!: boolean;

  @ApiProperty()
  staleThresholdDays!: number;

  @ApiProperty({ type: [BackupRunDto], description: 'Recent runs, newest first.' })
  recent!: BackupRunDto[];
}

/**
 * POST /admin/maintenance/run.
 *
 * The body depends on which job ran — `all` returns every section, a single job
 * returns only its own result. Documented as a free-form object rather than
 * invented into a union: the sections are internal counters whose shapes are
 * set by the jobs themselves, and pinning them here would make the contract
 * wrong the first time a job reports one more number.
 */
export class MaintenanceRunResultDto {
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true })
  sweep?: Record<string, unknown> | null;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true })
  retention?: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true, description: 'How many broadcasts were auto-ended.' })
  autoEndedEmergencies?: number | null;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true })
  scheduledReports?: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true, description: 'Whether the backup recency check failed.' })
  backupStale?: boolean | null;
}
