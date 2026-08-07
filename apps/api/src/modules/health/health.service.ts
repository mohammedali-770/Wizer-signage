import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { API_VERSION } from '../../common/version';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';

/** Shape of the liveness health payload returned by `GET /api/health`. */
export interface HealthStatus {
  readonly status: 'ok';
  readonly service: string;
  readonly version: string;
  readonly uptime: number;
  readonly timestamp: string;
}

/** Shape of the readiness payload returned by `GET /api/health/ready`. */
export interface ReadinessStatus {
  readonly status: 'ok' | 'degraded';
  readonly service: string;
  readonly checks: {
    /** Database connectivity (a lightweight `SELECT 1`). */
    readonly database: 'up' | 'down';
    /** True when an object-storage driver is configured (Supabase or local dev). */
    readonly storageConfigured: boolean;
    /** True when an SMTP transport is configured (else dev log-only). */
    readonly mailConfigured: boolean;
  };
  readonly timestamp: string;
}

const SERVICE_NAME = 'wizer-signage-api';

@Injectable()
export class HealthService {
  /**
   * Service version, read from `apps/api/package.json` — the same manifest that
   * stamps `info.version` into the committed contract.
   *
   * This used to read `npm_package_version`, which the production image never
   * sets (it starts with a bare `node dist/main.js`), so the endpoint an
   * operator checks after a deploy answered `0.0.0` for every release ever cut.
   */
  private readonly version: string = API_VERSION;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Liveness probe payload. Reports the process is up and serving requests. */
  check(): HealthStatus {
    return {
      status: 'ok',
      service: SERVICE_NAME,
      version: this.version,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness probe. Verifies the database is reachable and reports whether
   * storage/mail are configured. Deliberately returns ONLY booleans + an
   * up/down flag — never connection strings, hosts, or secrets — so it is safe
   * to expose to load balancers without auth.
   */
  async ready(): Promise<ReadinessStatus> {
    let database: 'up' | 'down' = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'up';
    } catch {
      database = 'down';
    }

    const supabase = this.config.get<AppConfig['supabase']>('supabase', { infer: true });
    const smtp = this.config.get<AppConfig['smtp']>('smtp', { infer: true });
    const storageConfigured = Boolean(
      (supabase?.url && supabase?.serviceRoleKey) || process.env.STORAGE_LOCAL_DIR,
    );
    const mailConfigured = Boolean(smtp?.host && smtp?.port);

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      service: SERVICE_NAME,
      checks: { database, storageConfigured, mailConfigured },
      timestamp: new Date().toISOString(),
    };
  }
}
