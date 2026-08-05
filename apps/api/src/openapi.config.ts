import { DocumentBuilder } from '@nestjs/swagger';

/**
 * The OpenAPI document definition, shared by the running app's `/api/docs` and
 * by `scripts/emit-openapi.ts`.
 *
 * Extracted so the committed contract and the served docs cannot drift: if this
 * lived only in `main.ts`, the emitter would build its own approximation and
 * the file in `contracts/` would slowly stop describing the real API.
 *
 * The version is passed in rather than read from `npm_package_version`, which is
 * set only when the process was started by npm/pnpm. Reading it here would emit
 * `0.0.0` under a bare `node dist/main.js` and the real version under
 * `pnpm start`, making the committed document flap between runs and turning the
 * CI drift check into noise.
 */
export function buildOpenApiConfig(version: string) {
  return new DocumentBuilder()
    .setTitle('Wizer Signage API')
    .setDescription('Wizer Signage — multi-tenant digital signage SaaS platform REST API.')
    .setVersion(version)
    .addBearerAuth()
    .build();
}
