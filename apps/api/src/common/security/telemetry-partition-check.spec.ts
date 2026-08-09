import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..', '..', '..', '..', '..');
const checkPath = resolve(root, 'scripts/assert-telemetry-partitions.sh');
const check = readFileSync(checkPath, 'utf8');

describe('telemetry physical-schema verifier', () => {
  it('is syntactically valid bash and read-only SQL', () => {
    expect(() => execFileSync('bash', ['-n', checkPath])).not.toThrow();
    expect(check).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/);
  });

  it('verifies both telemetry parents are RANGE partitioned', () => {
    expect(check).toContain('heartbeats proof_of_plays');
    expect(check).toContain('pg_partitioned_table');
    expect(check).toContain('is not a RANGE-partitioned parent');
  });

  it('verifies global proof-of-play idempotency infrastructure', () => {
    expect(check).toContain('proof_of_play_session_keys');
    expect(check).toContain('"companyId", "playbackSessionId"');
    expect(check).toContain('proof_of_plays_claim_session');
    expect(check).toContain('proof_of_plays_release_session');
  });

  it('requires rolling maintenance plus current and next-month children', () => {
    expect(check).toContain('wizer_ensure_telemetry_partitions');
    expect(check).toContain("interval '1 month'");
    expect(check).toContain('missing current/next telemetry partition');
  });

  it('rejects temporary swap-era parent object names', () => {
    expect(check).toContain('_partitioned_');
    expect(check).toContain('canonical names');
  });
});
