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
const verifier = readFileSync(
  resolve(root, 'scripts/assert-telemetry-partition-isolation.sh'),
  'utf8',
);
const schema = readFileSync(resolve(root, 'apps/api/prisma/schema.prisma'), 'utf8');

function modelBlock(name: string): string {
  const marker = `model ${name} {`;
  const start = schema.indexOf(marker);
  if (start < 0) throw new Error(`${name} is missing from Prisma schema`);
  let depth = 0;
  for (let i = schema.indexOf('{', start); i < schema.length; i += 1) {
    if (schema[i] === '{') depth += 1;
    else if (schema[i] === '}') {
      depth -= 1;
      if (depth === 0) return schema.slice(start, i + 1);
    }
  }
  throw new Error(`${name} model block is unterminated`);
}

describe('telemetry partition Prisma/PostgreSQL ownership boundary', () => {
  it('keeps only parent telemetry models in Prisma with physical composite primary keys', () => {
    const proof = modelBlock('ProofOfPlay');
    const heartbeat = modelBlock('Heartbeat');

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
    expect(verifier).toContain(
      "SELECT 'y' || to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC','YYYY')",
    );
    expect(verifier).toContain('wizer_telemetry.heartbeats_${suffix}');
    expect(verifier).toContain('wizer_telemetry.proof_of_plays_${suffix}');
  });

  it('verifies current and next month partitions after restore without platform-specific date arithmetic', () => {
    expect(verifier).toContain('CURRENT_SUFFIX');
    expect(verifier).toContain('NEXT_SUFFIX');
    expect(verifier).toContain("interval '1 month'");
    expect(verifier).not.toContain('date -u -d');
  });
});
