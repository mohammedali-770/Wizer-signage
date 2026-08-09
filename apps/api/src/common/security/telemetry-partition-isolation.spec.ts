import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..', '..', '..', '..', '..');
const conversionMigration = readFileSync(
  resolve(root, 'apps/api/prisma/migrations/20260809120000_partition_telemetry/migration.sql'),
  'utf8',
);
const isolationMigration = readFileSync(
  resolve(
    root,
    'apps/api/prisma/migrations/20260809123000_isolate_telemetry_partition_internals/migration.sql',
  ),
  'utf8',
);
const verifier = readFileSync(resolve(root, 'scripts/assert-telemetry-partition-isolation.sh'), 'utf8');
const schema = readFileSync(resolve(root, 'apps/api/prisma/schema.prisma'), 'utf8');

describe('telemetry partition Prisma/PostgreSQL ownership boundary', () => {
  it('keeps only parent telemetry models in Prisma with physical composite primary keys', () => {
    const proof = schema.slice(schema.indexOf('model ProofOfPlay {'), schema.indexOf('model Heartbeat {'));
    const heartbeat = schema.slice(schema.indexOf('model Heartbeat {'), schema.indexOf('model DeviceEvent {'));

    expect(proof).toContain('@@id([id, startedAt])');
    expect(proof).not.toContain('@@unique([companyId, playbackSessionId])');
    expect(heartbeat).toContain('@@id([id, createdAt])');
    expect(schema).not.toContain('model ProofOfPlaySessionKey');
  });

  it('moves PostgreSQL-only child partitions and the PoP registry into wizer_telemetry', () => {
    expect(isolationMigration).toContain('CREATE SCHEMA IF NOT EXISTS wizer_telemetry');
    expect(isolationMigration).toContain('ALTER TABLE %s SET SCHEMA wizer_telemetry');
    expect(isolationMigration).toContain('ALTER TABLE IF EXISTS public.proof_of_play_session_keys');
    expect(isolationMigration).toContain('SET SCHEMA wizer_telemetry');
  });

  it('pins trigger/helper lookup to the internal schema and fails mixed layouts', () => {
    expect(isolationMigration).toContain('SET search_path = wizer_telemetry, public');
    expect(isolationMigration).toContain('telemetry partition isolation failed');
    expect(verifier).toContain("n.nspname <> 'wizer_telemetry'");
    expect(verifier).toContain('proof_of_play_session_keys');
    expect(verifier).toContain('search_path=wizer_telemetry, public');
  });

  it('uses the conversion helper canonical yYYYYmMM child naming everywhere', () => {
    expect(conversionMigration).toContain("format('heartbeats_y%sm%s'");
    expect(conversionMigration).toContain("format('proof_of_plays_y%sm%s'");
    expect(verifier).toContain('y$(date -u +%Y)m$(date -u +%m)');
    expect(verifier).toContain('wizer_telemetry.heartbeats_${suffix}');
    expect(verifier).toContain('wizer_telemetry.proof_of_plays_${suffix}');
  });

  it('verifies current and next month partitions after restore', () => {
    expect(verifier).toContain('CURRENT_SUFFIX');
    expect(verifier).toContain('NEXT_SUFFIX');
  });
});
