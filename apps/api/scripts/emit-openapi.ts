import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';

import { buildOpenApiConfig } from '../src/openapi.config';

/**
 * Emit the OpenAPI document to a file.
 *
 *   pnpm --filter @wizer/api openapi:emit [outfile]
 *
 * PREVIEW MODE is what makes this runnable in CI. `NestFactory.create` would
 * instantiate every provider and fire onModuleInit — which opens a Prisma
 * connection — so emitting the contract would need a live database, and a
 * contract check that needs Postgres is one that gets skipped. Preview mode
 * builds the module graph and controller metadata without instantiating
 * providers, which is exactly what SwaggerModule.createDocument reads.
 *
 * The version is pinned from package.json rather than npm_package_version so the
 * output is identical however the script is invoked; otherwise the drift check
 * in CI would fail on a difference that means nothing.
 *
 * AppModule is imported lazily, INSIDE main(). Preview mode skips providers but
 * not module construction, and `ConfigModule.forRoot` validates the environment
 * while the module file is being evaluated — so a static import throws before
 * `main().catch(...)` exists to catch it, and the run ends on exit code 1 with
 * nothing written to stderr at all. Missing DATABASE_URL then looks identical to
 * a crash, an OOM, or a broken toolchain. Deferring the import puts the throw
 * inside the promise chain, where the handler below can name the cause.
 */
async function main(): Promise<void> {
  const out = resolve(
    process.argv[2] ?? join(__dirname, '..', '..', '..', 'contracts', 'openapi.json'),
  );

  // Read rather than import: a JSON import would be emitted into the module
  // graph and resolve differently once this file is compiled.
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
    version?: string;
  };
  const { AppModule } = await import('../src/app.module');
  const app = await NestFactory.create(AppModule, {
    preview: true,
    logger: false,
    // Without this, NestFactory handles a bootstrap error by logging it and
    // then ABORTING the process — and `logger: false` means it logs nowhere.
    // The run ends on exit code 1 having written not one byte, so a missing
    // DATABASE_URL is indistinguishable from an OOM or a broken toolchain.
    // `false` makes it reject instead, and the handler below names the cause.
    abortOnError: false,
  });
  const document = SwaggerModule.createDocument(app, buildOpenApiConfig(pkg.version ?? '0.0.0'));
  await app.close();

  // Trailing newline + 2-space indent so the file is diffable and every editor
  // leaves it alone.
  writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`);
  process.stdout.write(
    `OpenAPI written to ${out} (${Object.keys(document.paths ?? {}).length} paths)\n`,
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`Failed to emit OpenAPI: ${String(err)}\n`);
  // exitCode, not exit(): process.exit() tears the process down before an async
  // stderr pipe has flushed, which would put the message back where it started.
  process.exitCode = 1;
});
