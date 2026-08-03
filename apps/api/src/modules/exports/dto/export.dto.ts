import { Transform } from 'class-transformer';
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { DATASETS, FORMATS, type ExportDataset, type ExportFormat } from '../export.service';

/**
 * Query parameters for `GET /exports/:type`.
 *
 * The controller previously read these as bare `@Query('from')` strings, which
 * bypasses the global ValidationPipe entirely: `?from=yesterday` reached
 * `new Date(...)`, produced an Invalid Date, and surfaced as a 500 rather than a
 * 400. Declaring them here puts the export surface on the same validation
 * footing as every other endpoint.
 */
export class ExportQueryDto {
  /**
   * Case-insensitive on the wire — the previous controller did
   * `String(format).toUpperCase()`, and the dashboard's own links are documented
   * as `?format=csv`. Normalising here keeps those callers working while still
   * rejecting anything outside FORMATS.
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  @IsIn(FORMATS, { message: `format must be one of: ${FORMATS.join(', ')}` })
  format?: ExportFormat;

  /** Inclusive lower bound (ISO-8601). */
  @IsOptional()
  @IsDateString({}, { message: 'from must be an ISO-8601 date string.' })
  from?: string;

  /** Exclusive upper bound (ISO-8601). */
  @IsOptional()
  @IsDateString({}, { message: 'to must be an ISO-8601 date string.' })
  to?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'screenId must be a UUID.' })
  screenId?: string;

  /** Free-text status filter; bounded so it cannot be used to smuggle a payload. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  status?: string;
}

/** Route parameter for `GET /exports/:type`. */
export class ExportTypeParamDto {
  @IsIn(DATASETS, { message: `Unknown export type. Expected one of: ${DATASETS.join(', ')}` })
  type!: ExportDataset;
}
