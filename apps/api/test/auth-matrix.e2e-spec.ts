import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { AppModule } from '../src/app.module';
import { IS_PUBLIC_KEY } from '../src/common/decorators/public.decorator';

/**
 * Every authenticated GET route rejects an anonymous caller, checked against a
 * running app.
 *
 * `src/common/security/route-exposure.spec.ts` already pins WHICH routes carry
 * `@Public()`, statically and without a database. It cannot see one thing: that
 * `JwtAuthGuard` is still registered. Delete the `APP_GUARD` line in
 * `app.module.ts` and the metadata is unchanged — the static test stays green
 * while every route in the platform becomes anonymous.
 *
 * So this asserts the guard's observable effect rather than its declaration, by
 * driving real HTTP with no Authorization header.
 *
 * Restricted to GET on purpose. A guarded route never reaches its handler, so
 * the verb would not matter — but if one is NOT guarded, this test executes it.
 * Sweeping POST/PATCH/DELETE would mean writing to the database in exactly the
 * scenario the test exists to detect. GET is the safe half and covers the bulk
 * of the surface; the static spec covers the rest.
 *
 * Needs DATABASE_URL and a migrated schema (CI's `quality` job provides both).
 */

function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...controllerFiles(full));
    else if (entry.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

const trim = (v: unknown): string => (typeof v === 'string' ? v.replace(/^\/+|\/+$/g, '') : '');

/** Authenticated GET routes with no path parameters — safe to probe verbatim. */
function guardedGetRoutes(): string[] {
  const routes = new Set<string>();

  for (const file of controllerFiles(resolve(__dirname, '..', 'src'))) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(file) as Record<string, unknown>;

    for (const exported of Object.values(mod)) {
      if (typeof exported !== 'function') continue;
      const prefix = Reflect.getMetadata(PATH_METADATA, exported);
      if (prefix === undefined) continue;
      if (Reflect.getMetadata(IS_PUBLIC_KEY, exported) === true) continue;

      const proto = (exported as { prototype: object }).prototype;
      for (const member of Object.getOwnPropertyNames(proto)) {
        if (member === 'constructor') continue;
        const handler = (proto as Record<string, unknown>)[member];
        if (typeof handler !== 'function') continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) !== RequestMethod.GET) continue;
        if (Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true) continue;

        const path = [trim(prefix), trim(Reflect.getMetadata(PATH_METADATA, handler))]
          .filter(Boolean)
          .join('/');
        if (path.includes(':')) continue; // parameterised — skip rather than invent ids
        routes.add(`/api/${path}`);
      }
    }
  }
  return [...routes].sort();
}

describe('auth matrix (e2e)', () => {
  let app: INestApplication;
  const routes = guardedGetRoutes();

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('found a meaningful number of guarded GET routes to probe', () => {
    // Guards against the sweep silently covering nothing.
    expect(routes.length).toBeGreaterThan(20);
  });

  it('rejects every authenticated GET route without a token', async () => {
    const wrong: { route: string; status: number }[] = [];

    for (const route of routes) {
      const res = await request(app.getHttpServer()).get(route);
      // 401 is the expected answer. 404 is acceptable only where a route needs a
      // query parameter to resolve at all; anything 2xx means the route served
      // an anonymous caller, which is the bug this test exists for.
      if (res.status !== 401) wrong.push({ route, status: res.status });
    }

    expect(wrong.filter((w) => w.status < 400)).toEqual([]);
    expect(wrong).toEqual([]);
  }, 120_000);

  it('still serves the public health route anonymously', async () => {
    // The counterweight: if everything 401s because the app is misconfigured
    // rather than because the guard works, this catches it.
    const res = await request(app.getHttpServer()).get('/api/health');
    expect(res.status).toBe(200);
  });
});
