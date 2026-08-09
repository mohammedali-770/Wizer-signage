import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

const EXPECTED_PUBLIC_ROUTES: readonly string[] = [
  'GET /health',
  'GET /health/ready',
  'POST /auth/login',
  'POST /auth/login/2fa',
  'POST /auth/refresh',
  'POST /auth/forgot-password',
  'POST /auth/reset-password',
  'POST /auth/accept-invitation',
  'GET /public/plans',
  'POST /public/demo-request',
  'POST /public/trial-signup',
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
  // Separate constant-time scrape token; no human JWT is required.
  'GET /internal/metrics',
  'GET /content-files/:token',
  'GET /downloads/:file',
];

const EXPECTED_CLASS_LEVEL_PUBLIC: readonly string[] = [
  'ContentFilesController',
  'DeviceController',
  'DeviceProofOfPlayController',
  'DeviceTelemetryController',
  'DownloadsController',
  'HealthController',
  'PublicController',
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
      if (prefix === undefined) continue;

      const classPublic = Reflect.getMetadata(IS_PUBLIC_KEY, exported) === true;
      const proto = (exported as { prototype: object }).prototype;

      for (const member of Object.getOwnPropertyNames(proto)) {
        if (member === 'constructor') continue;
        const handler = (proto as Record<string, unknown>)[member];
        if (typeof handler !== 'function') continue;
        const verb = Reflect.getMetadata(METHOD_METADATA, handler);
        if (verb === undefined) continue;

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
    const actual = [...new Set(routes.filter((r) => r.classPublic).map((r) => r.controller))].sort();
    expect(actual).toEqual([...EXPECTED_CLASS_LEVEL_PUBLIC].sort());
  });

  it('keeps the large majority of routes behind JwtAuthGuard', () => {
    const publicCount = routes.filter((r) => r.isPublic).length;
    expect(publicCount).toBeLessThan(routes.length * 0.25);
  });
});
