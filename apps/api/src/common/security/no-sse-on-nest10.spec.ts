import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * Guard for GHSA-36xv-jgw5-4q75 (CVE-2026-35515).
 *
 * `SseStream._transform()` in @nestjs/core interpolates `message.type` and
 * `message.id` straight into the Server-Sent Events wire format without
 * escaping newlines, so anything able to influence those fields can inject
 * arbitrary SSE frames — event spoofing, and a `Last-Event-ID` that survives
 * reconnect.
 *
 * The fix landed in @nestjs/core 11.1.18. There is no 10.x backport: 10.4.22 is
 * the final 10.x release and is still affected. This API runs Nest 10.
 *
 * It is not exposed, because the vulnerable stream is unreachable. Nest only
 * constructs an SseStream when a route carries SSE_METADATA
 * (router-execution-context.js: `const isSseHandler = !!this.reflectSse(callback)`),
 * and only the `@Sse()` decorator sets that metadata. This API declares no SSE
 * route, so the code is never entered.
 *
 * "Unreachable today" is a fact about the code, not a property of it — the day
 * someone adds an `@Sse()` handler the advisory becomes live, silently, and the
 * audit gate would not catch it (the finding is moderate; CI blocks at high).
 * This test pins that assumption.
 *
 * Delete this test as part of the Nest 11 upgrade.
 */
describe('SSE is not used while @nestjs/core is on the 10.x line', () => {
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: __dirname,
    encoding: 'utf8',
  }).trim();

  /** Major version of the @nestjs/core actually resolved for this workspace. */
  const nestCoreMajor = (): number => {
    const pkg = require.resolve('@nestjs/core/package.json', { paths: [__dirname] });
    return Number(JSON.parse(readFileSync(pkg, 'utf8')).version.split('.')[0]);
  };

  /**
   * Source files declaring an SSE route. Searched via git so the sweep covers
   * the whole API source tree and never wanders into node_modules or dist.
   * `--untracked` so a newly written, not-yet-added handler is caught too.
   */
  const filesDeclaringSse = (): string[] => {
    let out = '';
    try {
      // Matches the decorator call, not the bare word, so prose mentioning SSE
      // in a comment does not trip the guard.
      out = execFileSync(
        'git',
        ['grep', '-l', '--untracked', '-E', '@Sse\\(', '--', 'apps/api/src'],
        { cwd: repoRoot, encoding: 'utf8' },
      ).trim();
    } catch {
      // git grep exits 1 when nothing matches — that is the passing case.
      return [];
    }
    return out
      .split('\n')
      .filter(Boolean)
      .filter((f) => !f.endsWith('no-sse-on-nest10.spec.ts'));
  };

  it('declares no @Sse() route handler', () => {
    if (nestCoreMajor() >= 11) return; // Patched line — the guard has served its purpose.

    const offenders = filesDeclaringSse();
    if (offenders.length > 0) {
      // Thrown rather than asserted so the remedy travels with the failure —
      // actionable without going and finding the advisory.
      throw new Error(
        `SSE route declared while on @nestjs/core 10.x: ${offenders.join(', ')}. ` +
          'That reaches SseStream, which is affected by GHSA-36xv-jgw5-4q75 and has no ' +
          '10.x fix. Upgrade @nestjs/core to >= 11.1.18 before shipping an SSE endpoint.',
      );
    }
    expect(offenders).toEqual([]);
  });

  it('actually searches the API source tree', () => {
    // Without this, a bad path or a swallowed git error would make the guard
    // above pass unconditionally and silently.
    let out = '';
    try {
      out = execFileSync(
        'git',
        ['grep', '-l', '--untracked', '-E', 'Controller\\(', '--', 'apps/api/src'],
        {
          cwd: repoRoot,
          encoding: 'utf8',
        },
      ).trim();
    } catch {
      out = '';
    }
    expect(out.split('\n').filter(Boolean).length).toBeGreaterThan(5);
  });
});
