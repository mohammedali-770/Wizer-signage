import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Min } from 'class-validator';

/**
 * Typed shape of a plan's limits (persisted as JSON on `Plan.limits`).
 *
 * Each field is a non-negative integer cap, or `null`/omitted to mean
 * "unlimited". `@IsOptional()` treats both `null` and `undefined` as absent.
 *
 * Every field carries `@ApiPropertyOptional` as well as its validators. Without
 * it this published as `{"type":"object","properties":{}}` — nested inside the
 * plan create/update bodies, so a caller was told to send `limits: {}` with no
 * way to discover a single cap. `class-validator` decorators are not swagger
 * metadata; the two have to be written side by side.
 */
export class PlanLimitsDto {
  /** Reseller-readiness: max child companies (future). */
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 0,
    description:
      'Max child companies. Reseller-readiness — not enforced in v1. Null or omitted means unlimited.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxCompanies?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 0,
    description: 'Max locations (branches). Null or omitted means unlimited.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxLocations?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 0,
    description: 'Max paired screens. Null or omitted means unlimited.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxScreens?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 0,
    description: 'Max user accounts in the company. Null or omitted means unlimited.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxUsers?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 0,
    description: 'Content storage cap, in gigabytes. Null or omitted means unlimited.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  storageGb?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 0,
    description: 'Largest single upload, in megabytes. Null or omitted means unlimited.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxFileSizeMb?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 0,
    description: 'Automatic screenshots per screen per day. Null or omitted means unlimited.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  autoScreenshotsPerDay?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 0,
    description: 'Max scheduled report definitions. Null or omitted means unlimited.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  scheduledReports?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 0,
    description:
      'Per-plan override of the retention window, in days. Null or omitted means unlimited.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  dataRetentionDays?: number | null;

  // Future-ready (not enforced in v1).
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 0,
    description: 'Future-ready. Not enforced in v1. Null or omitted means unlimited.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  apiRequestsPerDay?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 0,
    description: 'Future-ready. Not enforced in v1. Null or omitted means unlimited.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  webhooks?: number | null;
}
