/**
 * Typed configuration factory.
 *
 * Reads the canonical environment variables (see docs/environment-variables.md)
 * and returns a strongly-typed, nested config object that is registered with
 * `@nestjs/config` via `ConfigModule.forRoot({ load: [configuration] })`.
 *
 * Phase 1: the database and JWT/auth secrets are now REQUIRED (enforced in
 * env.validation.ts) since the API is no longer able to operate without them.
 */

export type NodeEnv = 'development' | 'test' | 'production';

export interface AppMetaConfig {
  readonly name: string;
  /** Public base URL of the dashboard — used to build email links. */
  readonly dashboardUrl: string;
}

export interface HttpConfig {
  /** Bind address. Defaults to 0.0.0.0 so the API is reachable from the Docker
   *  network (e.g. the nginx reverse proxy). Override with API_HOST. */
  readonly host: string;
  readonly port: number;
  readonly apiUrl?: string;
  readonly corsOrigins: string[];
  readonly wsPath: string;
}

export interface DatabaseConfig {
  /** Pooled connection string used at runtime. */
  readonly url?: string;
  /** Direct (non-pooled) connection string used by Prisma migrations. */
  readonly directUrl?: string;
  /** Convenience flag: true when a DATABASE_URL is configured. */
  readonly configured: boolean;
}

export interface SupabaseConfig {
  readonly url?: string;
  readonly anonKey?: string;
  readonly serviceRoleKey?: string;
  readonly storageBucket?: string;
}

export interface JwtConfig {
  readonly accessSecret?: string;
  readonly refreshSecret?: string;
  readonly accessTtl: string;
  readonly refreshTtl: string;
  readonly sessionInactivityTimeoutMinutes: number;
}

export interface SecurityConfig {
  /** Symmetric key used to encrypt secrets at rest (e.g. TOTP secrets). */
  readonly encryptionKey?: string;
}

export interface TwoFactorConfig {
  /** Issuer label shown in authenticator apps. */
  readonly issuer: string;
}

export interface SmtpConfig {
  readonly host?: string;
  readonly port?: number;
  readonly user?: string;
  readonly password?: string;
  readonly from?: string;
  /** Force TLS on connect (else derived from port 465). */
  readonly secure?: boolean;
}

export interface RetentionConfig {
  /** Default retention window for telemetry/operational data (days). */
  readonly days: number;
  /** Trash retention for soft-deleted content (days). */
  readonly trashDays: number;
}

export interface MapConfig {
  readonly provider?: string;
  readonly apiKey?: string;
}

export interface AppConfig {
  readonly nodeEnv: NodeEnv;
  readonly logLevel: string;
  readonly app: AppMetaConfig;
  readonly http: HttpConfig;
  readonly database: DatabaseConfig;
  readonly supabase: SupabaseConfig;
  readonly jwt: JwtConfig;
  readonly security: SecurityConfig;
  readonly twoFactor: TwoFactorConfig;
  readonly smtp: SmtpConfig;
  readonly retention: RetentionConfig;
  readonly map: MapConfig;
  readonly redisUrl?: string;
}

/** Parse a comma-separated origins list into a trimmed string array. */
function parseCorsOrigins(raw: string | undefined): string[] {
  if (!raw || raw.trim() === '') {
    return ['*'];
  }
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/** Parse an integer env var, falling back to a default when unset/invalid. */
function parseIntEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? fallback : value;
}

export default (): AppConfig => {
  const env = process.env;

  return {
    nodeEnv: (env.NODE_ENV as NodeEnv) ?? 'development',
    logLevel: env.LOG_LEVEL ?? 'info',
    app: {
      name: 'MasterSignage',
      dashboardUrl: env.APP_URL ?? env.DASHBOARD_URL ?? 'http://localhost:3000',
    },
    http: {
      // Bind all interfaces by default (required behind the Docker/nginx proxy).
      host: env.API_HOST ?? '0.0.0.0',
      port: parseIntEnv(env.API_PORT, 3001),
      apiUrl: env.API_URL,
      corsOrigins: parseCorsOrigins(env.CORS_ORIGINS),
      wsPath: env.WS_PATH ?? '/ws',
    },
    database: {
      url: env.DATABASE_URL,
      directUrl: env.DIRECT_URL,
      configured: Boolean(env.DATABASE_URL && env.DATABASE_URL.trim() !== ''),
    },
    supabase: {
      url: env.SUPABASE_URL,
      anonKey: env.SUPABASE_ANON_KEY,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      storageBucket: env.SUPABASE_STORAGE_BUCKET,
    },
    jwt: {
      accessSecret: env.JWT_ACCESS_SECRET,
      refreshSecret: env.JWT_REFRESH_SECRET,
      accessTtl: env.JWT_ACCESS_TTL ?? '15m',
      refreshTtl: env.JWT_REFRESH_TTL ?? '30d',
      sessionInactivityTimeoutMinutes: parseIntEnv(env.SESSION_INACTIVITY_TIMEOUT_MINUTES, 30),
    },
    security: {
      encryptionKey: env.ENCRYPTION_KEY,
    },
    twoFactor: {
      issuer: env.TWO_FACTOR_ISSUER ?? 'MasterSignage',
    },
    smtp: {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT ? parseIntEnv(env.SMTP_PORT, 587) : undefined,
      user: env.SMTP_USER,
      // Accept both SMTP_PASSWORD (canonical) and SMTP_PASS (spec alias).
      password: env.SMTP_PASSWORD ?? env.SMTP_PASS,
      from: env.SMTP_FROM,
      secure: env.SMTP_SECURE !== undefined ? env.SMTP_SECURE === 'true' : undefined,
    },
    retention: {
      days: parseIntEnv(env.RETENTION_DAYS, 90),
      trashDays: parseIntEnv(env.CONTENT_TRASH_RETENTION_DAYS, 14),
    },
    map: {
      provider: env.MAP_PROVIDER,
      apiKey: env.MAP_API_KEY,
    },
    redisUrl: env.REDIS_URL,
  };
};
