import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..', '..', '..', '..', '..');
const checkPath = resolve(root, 'scripts/assert-telemetry-partitions.sh');
const isolationPath = resolve(root, 'scripts/assert-telemetry-partition-isolation.sh');
const check = readFileSync(checkPath, 'utf8');
const isolation = readFileSync(isolationPath, 'utf8');

describe('telemetry physical-schema verifier', () => {
  it('is syntactically valid bash and read-only SQL across both verifier layers', () => {
    expect(() => execFileSync('bash', ['-n', checkPath])).not.toThrow();
    expect(() => execFileSync('bash', ['-n', isolationPath])).not.toThrow();
    for (const source of [check, isolation]) {
      expect(source).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/);
    }
  });

  it('verifies both telemetry parents are RANGE partitioned', () => {
    expect(check).toContain('heartbeats proof_of_plays');
    expect(check).toContain('pg_partitioned_table');
    expect(check).toContain('is not RANGE partitioned');
  });

  it('delegates and verifies global proof-of-play idempotency infrastructure', () => {
    expect(check).toContain('assert-telemetry-partition-isolation.sh');
    expect(isolation).toContain('proof_of_play_session_keys');
    expect(isolation).toContain('companyId,playbackSessionId');
    expect(isolation).toContain('TRIGGER_CONFIG_BAD');
    expect(isolation).toContain('search_path=wizer_telemetry, public');
  });

  it('requires rolling maintenance plus current and next-month children', () => {
    expect(check).toContain('assert-telemetry-partition-isolation.sh');
    expect(isolation).toContain('wizer_ensure_telemetry_partitions');
    expect(isolation).toContain("interval '1 month'");
    expect(isolation).toContain('CURRENT_SUFFIX');
    expect(isolation).toContain('NEXT_SUFFIX');
    expect(isolation).toContain('missing wizer_telemetry.heartbeats_');
    expect(isolation).toContain('missing wizer_telemetry.proof_of_plays_');
  });

  it('rejects temporary swap-era parent object names', () => {
    expect(check).toContain('BAD_NAMES');
    expect(check).toContain('_partitioned_');
  });
});
