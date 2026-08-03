/**
 * Environment variable validation.
 *
 * Uses class-validator + class-transformer to validate `process.env` at boot.
 *
 * Phase 1 promotes the database and auth secrets to REQUIRED: the API can no
 * longer operate without a database connection or JWT/encryption secrets, so we
 * fail fast at boot with a clear message rather than crashing later. Everything
 * not yet needed at runtime (Supabase storage, SMTP, maps, Redis) stays optional.
 */

import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum Environment {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

export class EnvironmentVariables {
  @IsOptional()
  @IsEnum(Environment, {
    message: `NODE_ENV must be one of: ${Object.values(Environment).join(', ')}`,
  })
  NODE_ENV?: Environment;

  @IsOptional()
  @IsString()
  LOG_LEVEL?: string;

  // --- App / URLs ---------------------------------------------------------
  @IsOptional()
  @IsString()
  APP_URL?: string;

  @IsOptional()
  @IsString()
  DASHBOARD_URL?: string;

  // --- Performance troubleshooting (all optional) -------------------------
  @IsOptional()
  @IsString()
  PERF_LOG_REQUESTS?: string; // 'true' → log every request line (default: slow-only)

  @IsOptional()
  @IsString()
  PERF_LOG_QUERIES?: string; // 'true' → log Prisma SQL + duration (never params)

  @IsOptional()
  @IsInt()
  PERF_SLOW_MS?: number; // request slow threshold (default 1000)

  @IsOptional()
  @IsInt()
  PERF_SLOW_QUERY_MS?: number; // query slow tag threshold (default 50)

  // --- HTTP ---------------------------------------------------------------
  @IsOptional()
  @IsString()
  API_HOST?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  API_PORT?: number;

  @IsOptional()
  @IsString()
  API_URL?: string;

  @IsOptional()
  @IsString()
  CORS_ORIGINS?: string;

  @IsOptional()
  @IsString()
  WS_PATH?: string;

  // --- Database (REQUIRED) ------------------------------------------------
  @IsString({ message: 'DATABASE_URL is required (Supabase Postgres connection string).' })
  DATABASE_URL!: string;

  @IsOptional()
  @IsString()
  DIRECT_URL?: string;

  // --- Supabase (required from Phase 4 — storage) -------------------------
  @IsOptional()
  @IsString()
  SUPABASE_URL?: string;

  @IsOptional()
  @IsString()
  SUPABASE_ANON_KEY?: string;

  @IsOptional()
  @IsString()
  SUPABASE_SERVICE_ROLE_KEY?: string;

  @IsOptional()
  @IsString()
  SUPABASE_STORAGE_BUCKET?: string;

  // --- JWT / sessions (REQUIRED) ------------------------------------------
  @IsString({ message: 'JWT_ACCESS_SECRET is required.' })
  @MinLength(16, { message: 'JWT_ACCESS_SECRET must be at least 16 characters.' })
  JWT_ACCESS_SECRET!: string;

  @IsString({ message: 'JWT_REFRESH_SECRET is required.' })
  @MinLength(16, { message: 'JWT_REFRESH_SECRET must be at least 16 characters.' })
  JWT_REFRESH_SECRET!: string;

  @IsOptional()
  @IsString()
  JWT_ACCESS_TTL?: string;

  @IsOptional()
  @IsString()
  JWT_REFRESH_TTL?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  SESSION_INACTIVITY_TIMEOUT_MINUTES?: number;

  // --- Encryption (REQUIRED) — encrypts secrets at rest (TOTP secrets) -----
  @IsString({ message: 'ENCRYPTION_KEY is required (used to encrypt 2FA secrets at rest).' })
  @MinLength(16, { message: 'ENCRYPTION_KEY must be at least 16 characters.' })
  ENCRYPTION_KEY!: string;

  // --- Two-factor ---------------------------------------------------------
  @IsOptional()
  @IsString()
  TWO_FACTOR_ISSUER?: string;

  // --- SMTP ---------------------------------------------------------------
  @IsOptional()
  @IsString()
  SMTP_HOST?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  SMTP_PORT?: number;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASSWORD?: string;

  @IsOptional()
  @IsString()
  SMTP_PASS?: string;

  @IsOptional()
  @IsString()
  SMTP_FROM?: string;

  @IsOptional()
  @IsString()
  SMTP_SECURE?: string;

  // --- Retention / maintenance (Phase 10) ---------------------------------
  @IsOptional()
  @IsInt()
  @Min(1)
  RETENTION_DAYS?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  CONTENT_TRASH_RETENTION_DAYS?: number;

  // --- Maps ---------------------------------------------------------------
  @IsOptional()
  @IsString()
  MAP_PROVIDER?: string;

  @IsOptional()
  @IsString()
  MAP_API_KEY?: string;

  // --- Cache / queues -----------------------------------------------------
  @IsOptional()
  @IsString()
  REDIS_URL?: string;

  // --- Seed (optional; used by prisma/seed.ts) ----------------------------
  @IsOptional()
  @IsString()
  SEED_SUPERADMIN_EMAIL?: string;

  @IsOptional()
  @IsString()
  SEED_SUPERADMIN_PASSWORD?: string;

  @IsOptional()
  @IsString()
  SEED_SUPERADMIN_NAME?: string;

  @IsOptional()
  @IsString()
  SEED_COMPANY_NAME?: string;
}

/**
 * Validation function passed to `ConfigModule.forRoot({ validate })`.
 * Throws an aggregated error if any constraint fails, preventing boot with a
 * misconfigured environment.
 */
export function validate(config: Record<string, unknown>): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    // Coerce string env values (e.g. "3001") into the declared types.
    enableImplicitConversion: true,
  });

  // skipMissingProperties:false so REQUIRED (non-@IsOptional) vars are enforced.
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const details = errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .filter((message) => message.length > 0)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  // --- Production-only requirements ----------------------------------------
  // SMTP is optional in dev (MailService falls back to a log-only transport),
  // but in production that fallback is dangerous: password-reset and invitation
  // emails would silently never be delivered while the API still returns
  // success, leaving users unable to reset or accept invites — and the flows
  // would appear healthy. Fail fast instead.
  if (validatedConfig.NODE_ENV === Environment.Production) {
    const missingSmtp = (['SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM'] as const).filter((key) => {
      const value = validatedConfig[key];
      return value === undefined || value === null || String(value).trim() === '';
    });
    if (missingSmtp.length > 0) {
      throw new Error(
        `Invalid environment configuration: ${missingSmtp.join(', ')} ${
          missingSmtp.length === 1 ? 'is' : 'are'
        } required when NODE_ENV=production (email delivery must not silently fall back to log-only).`,
      );
    }
  }

  return validatedConfig;
}
