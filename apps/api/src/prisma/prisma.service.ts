import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/** Minimal shape of Prisma's query-event emitter (present when log emit:'event'). */
interface PrismaQueryEmitter {
  $on(event: 'query', callback: (event: { query: string; duration: number }) => void): void;
}

/**
 * Thin wrapper around the generated Prisma client.
 *
 * - Connects on module init and logs the result.
 * - Patches BigInt serialization so models with BigInt columns (storage sizes,
 *   file sizes) can be returned in JSON responses without throwing.
 *
 * Tenant isolation is NOT performed here — every tenant-scoped query MUST pass
 * an explicit `companyId` in its `where` clause (see docs/multi-tenancy.md).
 * Postgres Row-Level Security can be layered on later as defense-in-depth.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // Opt-in query timing for perf troubleshooting (PERF_LOG_QUERIES=true).
    // Logs the SQL statement + duration ONLY — never the bound params/values,
    // which can contain emails, tokens, or other sensitive data.
    const logQueries = process.env.PERF_LOG_QUERIES === 'true';
    super({
      log: logQueries ? [{ emit: 'event', level: 'query' }, 'warn', 'error'] : ['warn', 'error'],
    });

    if (logQueries) {
      const slowMs = Number(process.env.PERF_SLOW_QUERY_MS ?? 50);
      // Cast: the event-emitter $on signature is only present when `log` is
      // configured with `emit: 'event'` (which it is, above).
      (this as unknown as PrismaQueryEmitter).$on('query', (event) => {
        const tag = event.duration >= slowMs ? 'SLOW QUERY' : 'query';
        this.logger.debug(`[${tag} ${event.duration}ms] ${event.query}`);
      });
    }

    // Make BigInt JSON-serializable (Prisma BigInt columns -> string in JSON).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (BigInt.prototype as any).toJSON = function (this: bigint): string {
      return this.toString();
    };
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Connected to the database.');
    } catch (error) {
      this.logger.error(
        'Failed to connect to the database. Check DATABASE_URL.',
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
