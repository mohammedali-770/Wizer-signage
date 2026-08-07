import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Deliberately not a plausible release number, so a fallback can never be
 * mistaken for one in a log line or a health payload.
 */
export const UNKNOWN_VERSION = '0.0.0-unknown';

/**
 * The API version, read once from `apps/api/package.json`.
 *
 * WHY NOT `npm_package_version`: that variable is set only when the process was
 * started by npm/pnpm. The production image runs `CMD ["node", "dist/main.js"]`
 * (see `apps/api/Dockerfile`), so it is UNSET there and every reader fell back
 * to the literal `'0.0.0'` — `GET /api/health` reported `0.0.0` no matter what
 * the package said. The same trap is already documented in `openapi.config.ts`,
 * which takes the version as a parameter for exactly this reason; the health
 * endpoint simply never got the memo, and `health-response.dto.ts` has always
 * described the version as "read from package.json" — the intent this restores.
 *
 * ONE relative path covers every layout, because `package.json` sits two levels
 * above this module in all of them:
 *
 *   ts-node   apps/api/src/common/version.ts   -> apps/api/package.json
 *   compiled  apps/api/dist/common/version.js  -> apps/api/package.json
 *   Docker    /app/dist/common/version.js      -> /app/package.json
 *
 * The Docker case works because the runtime stage copies the API manifest to
 * the image root (`COPY … /app/apps/api/package.json ./package.json`). Moving
 * this file to another directory depth, or dropping that COPY, breaks the read
 * — `version.spec.ts` pins both.
 *
 * `emit-openapi.ts` reads the same manifest to stamp `info.version` into
 * `contracts/openapi.json`, so the contract, the served Swagger docs and the
 * health endpoint cannot disagree.
 */
function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? UNKNOWN_VERSION;
  } catch {
    // Unreachable in all three layouts above. Kept because a health endpoint
    // that throws on startup over a cosmetic string would be a worse failure
    // than one reporting an obviously-wrong version.
    return UNKNOWN_VERSION;
  }
}

/** Resolved once at module load — the manifest cannot change under a running process. */
export const API_VERSION: string = readVersion();
