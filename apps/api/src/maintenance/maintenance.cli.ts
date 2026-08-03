/**
 * Maintenance CLI (Phase 10).
 *
 * A standalone Nest application context (no HTTP server) that runs a single
 * maintenance job and exits. Intended to be invoked by cron / a Docker worker —
 * NOT an in-process scheduler (see docs/data-retention.md).
 *
 *   node dist/maintenance/maintenance.cli.js all
 *   node dist/maintenance/maintenance.cli.js retention
 *   node dist/maintenance/maintenance.cli.js sweep|reports|emergencies|backup-check
 *   node dist/maintenance/maintenance.cli.js record-backup --type=DATABASE --status=SUCCESS --location=s3://... --size=12345
 *
 * In dev: `pnpm --filter @wizer/api maintenance all`.
 */
import { NestFactory } from '@nestjs/core';
import { BackupStatus, BackupType } from '@prisma/client';

import { AppModule } from '../app.module';
import { BackupService } from '../modules/maintenance/backup.service';
import { MaintenanceService } from '../modules/maintenance/maintenance.service';

type Flags = Record<string, string>;

function parseFlags(args: string[]): Flags {
  const flags: Flags = {};
  for (const arg of args) {
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (m && m[1] !== undefined) flags[m[1]] = m[2] ?? '';
  }
  return flags;
}

/**
 * Pull `retention.failures` out of whatever shape the job returned — `run('all')`
 * nests it under `retention`, `run('retention')` returns it directly. Defensive
 * on purpose: a shape change must degrade to "no failures detected", never throw
 * inside the error-reporting path.
 */
function collectRetentionFailures(result: unknown): string[] {
  if (typeof result !== 'object' || result === null) return [];
  const record = result as Record<string, unknown>;
  const candidates = [record, record.retention];
  const failures: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const value = (candidate as Record<string, unknown>).failures;
    if (Array.isArray(value)) failures.push(...value.map((v) => String(v)));
  }
  return failures;
}

async function main(): Promise<void> {
  const [command = 'all', ...rest] = process.argv.slice(2);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    if (command === 'record-backup') {
      const flags = parseFlags(rest);
      const type = (flags.type?.toUpperCase() as BackupType) ?? BackupType.DATABASE;
      const status = (flags.status?.toUpperCase() as BackupStatus) ?? BackupStatus.SUCCESS;
      const run = await app.get(BackupService).record({
        type,
        status,
        location: flags.location,
        sizeBytes: flags.size ? Number(flags.size) : undefined,
        error: flags.error,
      });
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(run));
    } else {
      const job = command as
        | 'all'
        | 'sweep'
        | 'retention'
        | 'reports'
        | 'emergencies'
        | 'backup-check';
      const result = await app.get(MaintenanceService).run(job);
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ job, result }));

      // A retention step that ERRORED must not exit 0. Retention failures are
      // silent by nature — the row counts simply read as zero — so a broken
      // cleanup can run for months while the database grows until writes stop.
      // Exiting non-zero makes cron/`docker logs` and any wrapper surface it.
      const failures = collectRetentionFailures(result);
      if (failures.length > 0) {
        // eslint-disable-next-line no-console
        console.error(`[maintenance-cli] retention steps failed: ${failures.join(' | ')}`);
        process.exitCode = 1;
      }
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[maintenance-cli] failed:', error instanceof Error ? error.stack : error);
  process.exit(1);
});
