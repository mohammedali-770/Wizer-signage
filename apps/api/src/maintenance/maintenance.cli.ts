/**
 * Maintenance CLI (Phase 10).
 *
 * A standalone Nest application context (no HTTP server) that runs a single
 * maintenance job and exits. Intended to be invoked by cron / a Docker worker —
 * NOT an in-process scheduler (see docs/data-retention.md).
 */
import { NestFactory } from '@nestjs/core';
import { BackupStatus, BackupType } from '@prisma/client';

import { AppModule } from '../app.module';
import { AndroidOtaHealthService } from '../modules/maintenance/android-ota-health.service';
import { BackupService } from '../modules/maintenance/backup.service';
import { ImportCommitWorkerService } from '../modules/maintenance/import-commit-worker.service';
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
    } else if (command === 'android-ota-health') {
      const result = await app.get(AndroidOtaHealthService).sweep();
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ job: command, result }));
    } else if (command === 'imports') {
      // CLI-only background worker. HTTP requests enqueue validated imports;
      // entity writes happen here so a reverse-proxy timeout cannot cause a
      // browser retry to replay thousands of row creations.
      const result = await app.get(ImportCommitWorkerService).run();
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ job: command, result }));
      if (result.failed > 0) process.exitCode = 1;
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
