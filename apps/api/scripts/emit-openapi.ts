import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';

import { AppModule } from '../src/app.module';
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
  const app = await NestFactory.create(AppModule, {
    preview: true,
    logger: false,
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
  process.exit(1);
});
