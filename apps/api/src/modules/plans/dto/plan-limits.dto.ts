import { IsInt, IsOptional, Min } from 'class-validator';

/**
 * Typed shape of a plan's limits (persisted as JSON on `Plan.limits`).
 *
 * Each field is a non-negative integer cap, or `null`/omitted to mean
 * "unlimited". `@IsOptional()` treats both `null` and `undefined` as absent.
 */
export class PlanLimitsDto {
  /** Reseller-readiness: max child companies (future). */
  @IsOptional()
  @IsInt()
  @Min(0)
  maxCompanies?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxLocations?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxScreens?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxUsers?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  storageGb?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxFileSizeMb?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  autoScreenshotsPerDay?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  scheduledReports?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  dataRetentionDays?: number | null;

  // Future-ready (not enforced in v1).
  @IsOptional()
  @IsInt()
  @Min(0)
  apiRequestsPerDay?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  webhooks?: number | null;
}
