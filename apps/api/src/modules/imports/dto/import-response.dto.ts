import { ImportStatus, ImportType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Import response shapes.
 *
 * The module has ONE `toView` and three endpoints that spread extra fields on
 * top of it — detail adds `preview`, commit adds three commit counters. Rather
 * than one class carrying every optional field (which would tell a client the
 * list rows might contain a preview), each is its own class extending the base.
 */

/** An import job as the list returns it. */
export class ImportJobDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  companyId!: string;

  @ApiProperty({ enum: Object.values(ImportType) })
  type!: string;

  @ApiProperty({ enum: Object.values(ImportStatus) })
  status!: string;

  @ApiProperty({ description: 'The uploaded filename, as given.' })
  fileName!: string;

  @ApiProperty()
  totalRows!: number;

  @ApiProperty()
  validRows!: number;

  @ApiProperty()
  invalidRows!: number;

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'Per-row validation errors found during upload. `[]` when the file was clean.',
  })
  errors!: Record<string, unknown>[];

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  committedAt?: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

/** GET /imports/{id} — the job plus the parsed rows it is holding. */
export class ImportJobDetailDto extends ImportJobDto {
  @ApiPropertyOptional({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    nullable: true,
    description:
      'The parsed rows awaiting commit. Only the DETAIL route loads this — the list never ' +
      'carries it, which is why these are separate classes.',
  })
  preview?: Record<string, unknown>[] | null;
}

/** POST /imports/{id}/commit — the job plus what the commit actually did. */
export class ImportCommitResultDto extends ImportJobDto {
  @ApiProperty({ description: 'Rows successfully created.' })
  committed!: number;

  @ApiProperty({
    description:
      'Rows that failed AT COMMIT time — distinct from `invalidRows`, which counts what upload ' +
      'validation rejected. A row can pass upload and still fail here, on a plan limit or a ' +
      'uniqueness clash created since.',
  })
  failed!: number;

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'The commit-time failures, one entry each.',
  })
  rowErrors!: Record<string, unknown>[];
}
