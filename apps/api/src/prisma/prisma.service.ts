import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

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
    super({ log: ['warn', 'error'] });

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
