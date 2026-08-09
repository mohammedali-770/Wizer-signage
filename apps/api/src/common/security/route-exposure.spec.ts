import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Every route reachable WITHOUT a user access token, pinned as a snapshot.
 *
 * `JwtAuthGuard` is global (`app.module.ts`, APP_GUARD), so a route requires a
 * token unless something marks it `@Public()`. Nothing else in the suite checks
 * which routes those are: the unit tests instantiate services directly and never
 * exercise a guard, so a route that becomes accidentally public answers exactly
 * as before and ships green.
 *
 * The sharpest version of that is a CLASS-level `@Public()`. It exempts every
 * route in the controller — including ones added months later by someone who
 * never saw the decorator, because it sits above the class and not above their
 * handler. Those are asserted separately below.
 *
 * This reads Nest's own routing metadata off the controller classes instead of
 * booting the app, so it needs no database, no DI graph and no HTTP server, and
 * it cannot drift from what Nest actually registers at runtime.
 *
 * WHEN THIS FAILS: a route's exposure changed. Either revert it, or add it here
 * with a comment justifying anonymous/user-JWT bypass access. Do not silence it
 * by pasting the received array — read the route and its alternate guard first.
 */

/**
 * Routes intentionally reachable with no USER access token.
 *
 * The `/device/*` routes are not unauthenticated: they are authenticated by a
 * DEVICE token via `DeviceAuthGuard`, which is a different credential than a
 * user JWT, so they must bypass `JwtAuthGuard` to reach their own guard.
 * `/internal/metrics` similarly uses a dedicated scrape-token guard.
 */
const EXPECTED_PUBLIC_ROUTES: readonly string[] = [
  // --- Health: probed by Docker, the deploy gate and the external monitor ----
  'GET /health',
  'GET /health/ready',

  // --- Credential flows: pre-authentication by definition -------------------
  'POST /auth/login',
  'POST /auth/login/2fa',
  'POST /auth/refresh',
  'POST /auth/forgot-password',
  'POST /auth/reset-password',
  'POST /auth/accept-invitation',

  // --- Marketing site / self-serve trial ------------------------------------
  'GET /public/plans',
  'POST /public/demo-request',
  'POST /public/trial-signup',

  // --- Device API: guarded by DeviceAuthGuard, not by a user JWT ------------
  'POST /device/pairing/start',
  'GET /device/pairing/status',
  'GET /device/config',
  'GET /device/manifest',
  'GET /device/sync-plan',
  'POST /device/sync-status',
  'POST /device/heartbeat',
  'POST /device/crash-report',
  'GET /device/commands/pending',
  'POST /device/commands/:id/ack',
  'POST /device/commands/:id/result',
  'GET /device/content/:contentId/download',
  'POST /device/proof-of-play/events',
  'POST /device/screenshots',

  // --- Internal scrape: separate secret, no human session -------------------
  // `MetricsTokenGuard` fails closed if METRICS_TOKEN is absent/weak and uses a
  // constant-time comparison. Never expose this route through the public proxy.
  'GET /internal/metrics',

  // --- Local storage adapter (development only) -----------------------------
  // The :token is an encrypted, time-limited reference to a storage key. In
  // production storage is Supabase and signed URLs bypass this route entirely.
  'GET /content-files/:token',

  // --- APK distribution: the player has no credentials before pairing -------
  // In production nginx serves /api/downloads/android/ directly from a
  // read-only mount and this handler is never reached for that subtree.
  'GET /downloads/:file',
];

/**
 * Controllers whose `@Public()` sits on the CLASS. Every present and future
 * route inside them bypasses the user-JWT guard, so adding one here is a
 * deliberate decision and the controller must provide its own boundary where
 * appropriate (e.g. DeviceAuthGuard).
 */
const EXPECTED_CLASS_LEVEL_PUBLIC: readonly string[] = [
  'ContentFilesController', // dev-only local storage adapter, token-scoped
  'DeviceController', // device-token authenticated via DeviceAuthGuard
  'DeviceProofOfPlayController', // ditto
  'DeviceTelemetryController', // ditto, including bounded crash reports
  'DownloadsController', // APK distribution, pre-pairing
  'HealthController', // liveness/readiness probes
  'PublicController', // marketing site + self-serve trial signup
];

function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...controllerFiles(full));
    else if (entry.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

const METHOD_NAMES: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.ALL]: 'ALL',
  [RequestMethod.OPTIONS]: 'OPTIONS',
  [RequestMethod.HEAD]: 'HEAD',
};

const trim = (v: unknown): string => (typeof v === 'string' ? v.replace(/^\/+|\/+$/g, '') : '');

interface Route {
  readonly signature: string;
  readonly isPublic: boolean;
  readonly classPublic: boolean;
  readonly controller: string;
}

function collectRoutes(): Route[] {
  const srcRoot = resolve(__dirname, '..', '..');
  const found: Route[] = [];

  for (const file of controllerFiles(srcRoot)) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(file) as Record<string, unknown>;

    for (const [name, exported] of Object.entries(mod)) {
      if (typeof exported !== 'function') continue;
      const prefix = Reflect.getMetadata(PATH_METADATA, exported);
      if (prefix === undefined) continue; // not a @Controller

      const classPublic = Reflect.getMetadata(IS_PUBLIC_KEY, exported) === true;
      const proto = (exported as { prototype: object }).prototype;

      for (const member of Object.getOwnPropertyNames(proto)) {
        if (member === 'constructor') continue;
        const handler = (proto as Record<string, unknown>)[member];
        if (typeof handler !== 'function') continue;

        const verb = Reflect.getMetadata(METHOD_METADATA, handler);
        if (verb === undefined) continue; // not a route handler

        const path = [trim(prefix), trim(Reflect.getMetadata(PATH_METADATA, handler))]
          .filter(Boolean)
          .join('/');

        found.push({
          signature: `${METHOD_NAMES[verb as number] ?? String(verb)} /${path}`,
          isPublic: classPublic || Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true,
          classPublic,
          controller: name,
        });
      }
    }
  }
  return found;
}

describe('route exposure', () => {
  const routes = collectRoutes();

  it('discovers the controllers at all', () => {
    // Without this, a wrong path or a renamed suffix would make every assertion
    // below vacuously true — the failure mode this whole file exists to prevent.
    expect(routes.length).toBeGreaterThan(100);
  });

  it('exposes exactly the expected routes without a user access token', () => {
    const actual = routes
      .filter((r) => r.isPublic)
      .map((r) => r.signature)
      .sort();
    expect(actual).toEqual([...EXPECTED_PUBLIC_ROUTES].sort());
  });

  it('applies class-level @Public() only to the expected controllers', () => {
    const actual = [
      ...new Set(routes.filter((r) => r.classPublic).map((r) => r.controller)),
    ].sort();
    expect(actual).toEqual([...EXPECTED_CLASS_LEVEL_PUBLIC].sort());
  });

  it('keeps the large majority of routes behind JwtAuthGuard', () => {
    // A blunt bound that still moves if a class-level @Public() lands on a big
    // tenant controller, even were someone to update the lists above.
    const publicCount = routes.filter((r) => r.isPublic).length;
    expect(publicCount).toBeLessThan(routes.length * 0.25);
  });
});
