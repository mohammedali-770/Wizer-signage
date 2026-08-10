/**
 * Environment variable validation.
 *
 * Uses class-validator + class-transformer to validate `process.env` at boot.
 * Core database/auth secrets are always required. Production additionally fails
 * closed unless public email-link origin, live SMTP and persistent Supabase
 * Storage are configured; development fallbacks must never be reachable in a
 * production process.
 */

import { URL } from 'node:url';

import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export const JWT_TTL_PATTERN =
  /^\d+(\.\d+)?\s*(ms|s(ec(ond)?s?)?|m(in(ute)?s?)?|h(r|our)?s?|d(ay)?s?|w(eek)?s?|y(ear)?s?)$/i;

export const JWT_TTL_MESSAGE = (name: string): string =>
  `${name} must be a duration with an explicit unit (e.g. 15m, 30d, 2h). ` +
  'A bare number is rejected because it would be read as milliseconds, not seconds.';

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

  @IsOptional()
  @IsString()
  APP_URL?: string;

  @IsOptional()
  @IsString()
  DASHBOARD_URL?: string;

  @IsOptional()
  @IsString()
  PERF_LOG_REQUESTS?: string;

  @IsOptional()
  @IsString()
  PERF_LOG_QUERIES?: string;

  @IsOptional()
  @IsInt()
  PERF_SLOW_MS?: number;

  @IsOptional()
  @IsInt()
  PERF_SLOW_QUERY_MS?: number;

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

  @IsString({ message: 'DATABASE_URL is required (Supabase Postgres connection string).' })
  DATABASE_URL!: string;

  @IsOptional()
  @IsString()
  DIRECT_URL?: string;

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

  @IsString({ message: 'JWT_ACCESS_SECRET is required.' })
  @MinLength(16, { message: 'JWT_ACCESS_SECRET must be at least 16 characters.' })
  JWT_ACCESS_SECRET!: string;

  @IsString({ message: 'JWT_REFRESH_SECRET is required.' })
  @MinLength(16, { message: 'JWT_REFRESH_SECRET must be at least 16 characters.' })
  JWT_REFRESH_SECRET!: string;

  @IsOptional()
  @Matches(JWT_TTL_PATTERN, { message: JWT_TTL_MESSAGE('JWT_ACCESS_TTL') })
  JWT_ACCESS_TTL?: string;

  @IsOptional()
  @Matches(JWT_TTL_PATTERN, { message: JWT_TTL_MESSAGE('JWT_REFRESH_TTL') })
  JWT_REFRESH_TTL?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  SESSION_INACTIVITY_TIMEOUT_MINUTES?: number;

  @IsString({ message: 'ENCRYPTION_KEY is required (used to encrypt 2FA secrets at rest).' })
  @MinLength(16, { message: 'ENCRYPTION_KEY must be at least 16 characters.' })
  ENCRYPTION_KEY!: string;

  @IsOptional()
  @IsString()
  TWO_FACTOR_ISSUER?: string;

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

  @IsOptional()
  @IsInt()
  @Min(1)
  RETENTION_DAYS?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  CONTENT_TRASH_RETENTION_DAYS?: number;

  @IsOptional()
  @IsString()
  MAP_PROVIDER?: string;

  @IsOptional()
  @IsString()
  MAP_API_KEY?: string;

  @IsOptional()
  @IsString()
  REDIS_URL?: string;

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

function validateProductionDashboardOrigin(config: EnvironmentVariables): void {
  // configuration.ts resolves APP_URL first, then DASHBOARD_URL. Validate the
  // exact same winner so a stale/bad APP_URL cannot silently override a correct
  // DASHBOARD_URL in password-reset and invitation emails.
  const raw = (config.APP_URL ?? config.DASHBOARD_URL)?.trim();
  if (!raw) {
    throw new Error(
      'Invalid environment configuration: APP_URL or DASHBOARD_URL is required when NODE_ENV=production (email links need the public dashboard origin).',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      'Invalid environment configuration: APP_URL/DASHBOARD_URL must be a valid HTTPS dashboard origin.',
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  const privateIpv4 =
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
  const localHost =
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.invalid') ||
    privateIpv4;

  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    (parsed.pathname !== '' && parsed.pathname !== '/') ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    localHost
  ) {
    throw new Error(
      'Invalid environment configuration: APP_URL/DASHBOARD_URL must be a public HTTPS origin with no credentials, path, query, fragment, or local/private host.',
    );
  }
}

export function validate(config: Record<string, unknown>): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

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

  if (validatedConfig.NODE_ENV === Environment.Production) {
    validateProductionDashboardOrigin(validatedConfig);

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

    const missingStorage = (
      ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_STORAGE_BUCKET'] as const
    ).filter((key) => {
      const value = validatedConfig[key];
      return value === undefined || value === null || String(value).trim() === '';
    });
    if (missingStorage.length > 0) {
      throw new Error(
        `Invalid environment configuration: ${missingStorage.join(', ')} ${
          missingStorage.length === 1 ? 'is' : 'are'
        } required when NODE_ENV=production (content storage must not fall back to ephemeral local disk).`,
      );
    }
  }

  return validatedConfig;
}
