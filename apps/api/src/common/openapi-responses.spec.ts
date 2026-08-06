import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CompanyStatus,
  DemoRequestStatus,
  ReportDeliveryStatus,
  ReportType,
  SubscriptionStatus,
} from '@prisma/client';

/**
 * Response coverage in the committed OpenAPI contract.
 *
 * The contract described 67 request DTOs and ZERO response models, because
 * exactly one of 38 controllers declared a response type. It documented what
 * clients send and said nothing about what they get back — so generating the
 * dashboard's hand-copied `types.ts` from it would have produced nothing usable,
 * and any client reading it was guessing.
 *
 * `@nestjs/swagger` reflects decorator metadata, and a TypeScript interface is
 * erased at compile time, so annotating a route means writing a response CLASS
 * and pointing `@ApiOkResponse` at it. That is mechanical but not free, and it
 * lands controller by controller.
 *
 * This spec exists so that lands in one direction. The floor below is a ratchet:
 * raise it as controllers are annotated, and a route that LOSES its response
 * type fails immediately.
 */

const CONTRACT = join(__dirname, '..', '..', '..', '..', 'contracts', 'openapi.json');

interface Operation {
  responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
}

function loadContract(): {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, unknown> };
} {
  try {
    return JSON.parse(readFileSync(CONTRACT, 'utf8')) as never;
  } catch (e) {
    throw new Error(
      `Could not read ${CONTRACT}. Regenerate it with: pnpm --filter @wizer/api openapi:emit (${String(e)})`,
    );
  }
}

/** Every `*.controller.ts` under src/modules, recursively. */
function controllerFiles(root = join(__dirname, '..', 'modules')): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) found.push(...controllerFiles(path));
    else if (entry.name.endsWith('.controller.ts')) found.push(path);
  }
  return found;
}

/** Operations that declare a success response with an actual schema. */
function operationsWithResponseSchema(): { annotated: string[]; total: number } {
  const { paths } = loadContract();
  const annotated: string[] = [];
  let total = 0;

  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(methods)) {
      total += 1;
      const success = op.responses?.['200'] ?? op.responses?.['201'];
      const schema = success?.content?.['application/json']?.schema;
      if (schema && Object.keys(schema as object).length > 0) {
        annotated.push(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  return { annotated, total };
}

describe('OpenAPI response coverage', () => {
  it('every auth route declares what it returns', () => {
    // The module annotated first, and the one a client integrates against
    // before anything else.
    const { annotated } = operationsWithResponseSchema();
    for (const route of [
      'POST /auth/login',
      'POST /auth/login/2fa',
      'POST /auth/refresh',
      'POST /auth/logout',
      'POST /auth/forgot-password',
      'POST /auth/reset-password',
      'POST /auth/accept-invitation',
      'GET /auth/me',
    ]) {
      expect(annotated).toContain(route);
    }
  });

  it('POST /auth/login documents BOTH outcomes, not just the happy one', () => {
    // An account with 2FA gets a challenge and NO tokens. Documenting only the
    // token shape promises clients an accessToken that is not in the response.
    const { paths } = loadContract();
    const schema = paths['/auth/login']?.post?.responses?.['200']?.content?.['application/json']
      ?.schema as { oneOf?: Array<{ $ref: string }> } | undefined;

    const refs = (schema?.oneOf ?? []).map((s) => s.$ref);
    expect(refs).toEqual(
      expect.arrayContaining([
        '#/components/schemas/AuthTokensDto',
        '#/components/schemas/TwoFactorChallengeDto',
      ]),
    );
  });

  it('the redacted user view never promises a secret field', () => {
    // This class is published documentation: a field added here is a field the
    // contract says the API returns. The three below are the ones `toView`
    // exists to strip.
    const { components } = loadContract();
    const user = components.schemas.UserViewDto as { properties?: Record<string, unknown> };
    const props = Object.keys(user?.properties ?? {});

    for (const secret of ['passwordHash', 'twoFactorSecret', 'twoFactorPendingSecret']) {
      expect(props).not.toContain(secret);
    }
    expect(props).toContain('email');
  });

  it('every users route declares what it returns', () => {
    const { annotated } = operationsWithResponseSchema();
    for (const route of [
      'GET /users',
      'GET /users/{id}',
      'PATCH /users/{id}',
      'POST /users/{id}/disable',
      'POST /users/{id}/enable',
      'POST /users/{id}/unlock',
      'DELETE /users/{id}',
    ]) {
      expect(annotated).toContain(route);
    }
  });

  it('list endpoints describe the pagination envelope, not a bare array', () => {
    // Swagger cannot express a generic — `type: Paginated<UserViewDto>` compiles
    // and emits nothing, because the generic is erased before the decorator sees
    // it. ApiPaginatedResponse writes the envelope out; this pins that it stays
    // an { items, meta } object and not the array the item type alone implies.
    const { paths } = loadContract();
    const schema = paths['/users']?.get?.responses?.['200']?.content?.['application/json']
      ?.schema as { properties?: Record<string, { items?: { $ref?: string } }> } | undefined;

    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual(['items', 'meta']);
    expect(schema?.properties?.items?.items?.$ref).toBe('#/components/schemas/UserViewDto');
  });

  it('the screen shape never publishes the kiosk PIN hash', () => {
    // ScreensService.toView strips `kioskPinHash` and substitutes `hasKioskPin`.
    // A DTO written from the PRISMA MODEL instead of the view would document a
    // password-hash field as part of the API, and the name sits close enough to
    // the other 32 to survive a skim. This is the check that makes writing the
    // DTO from the wrong source fail loudly.
    const { components } = loadContract();
    const screen = components.schemas.ScreenDto as { properties?: Record<string, unknown> };
    const props = Object.keys(screen?.properties ?? {});

    expect(props).not.toContain('kioskPinHash');
    expect(props).toContain('hasKioskPin');
  });

  it('64-bit byte counts are documented as strings, not numbers', () => {
    // PrismaService patches BigInt.prototype.toJSON, so these serialise as
    // strings. Documenting them as `number` would tell clients to parse a value
    // that arrives quoted — and would imply a precision the column does not have.
    const { components } = loadContract();
    const screen = components.schemas.ScreenDto as {
      properties?: Record<string, { type?: string }>;
    };
    expect(screen?.properties?.storageUsedBytes?.type).toBe('string');
    expect(screen?.properties?.storageTotalBytes?.type).toBe('string');
  });

  it('the content shape never publishes the storage key', () => {
    // ContentService.toView strips storageKey, checksum and meta. storageKey is
    // the object-storage path — publishing it hands a client the internal layout
    // of the bucket, when files are meant to be reached only through a
    // short-lived signed URL from the preview endpoint.
    const { components } = loadContract();
    const content = components.schemas.ContentDto as { properties?: Record<string, unknown> };
    const props = Object.keys(content?.properties ?? {});

    for (const stripped of ['storageKey', 'checksum', 'meta']) {
      expect(props).not.toContain(stripped);
    }
    // Derived at read time; there is no such column.
    expect(props).toContain('isExpired');
  });

  it('the playlist LIST row does not promise the detail-only fields', () => {
    // toDetailView computes seven fields that exist in no column — the validity
    // counts, total duration, orientation profile, schedulable, warnings — and
    // the list endpoint sends none of them. One shared schema would tell clients
    // the list carries data it never loads.
    const { components } = loadContract();
    const summary = components.schemas.PlaylistSummaryDto as {
      properties?: Record<string, unknown>;
    };
    const detail = components.schemas.PlaylistDetailDto as {
      properties?: Record<string, unknown>;
    };

    for (const detailOnly of ['items', 'schedulable', 'warnings', 'totalDurationSeconds']) {
      expect(Object.keys(summary?.properties ?? {})).not.toContain(detailOnly);
      expect(Object.keys(detail?.properties ?? {})).toContain(detailOnly);
    }
    // Both carry the count, which the list gets from a Prisma _count.
    expect(Object.keys(summary?.properties ?? {})).toContain('itemCount');
  });

  it.each([
    ['UserViewDto', ['passwordHash', 'twoFactorSecret', 'twoFactorPendingSecret']],
    ['ScreenDto', ['kioskPinHash']],
    ['CompanyDto', ['defaultKioskPinHash']],
    ['ContentDto', ['storageKey', 'checksum', 'meta']],
  ])('%s publishes none of the fields its view strips', (schema, stripped) => {
    // Four views now exist to keep something out of the response, three of them
    // a hashed secret. That is a pattern, not a coincidence, and it is the
    // reason every DTO here is transcribed from the service's view and never
    // from the Prisma model — a model-derived class would publish all of these.
    const { components } = loadContract();
    const model = components.schemas[schema] as { properties?: Record<string, unknown> };
    const props = Object.keys(model?.properties ?? {});
    for (const field of stripped) {
      expect(props).not.toContain(field);
    }
  });

  it('a bare @Post documents 201, not 200', () => {
    // Nest answers 201 for a @Post with no @HttpCode, and 200 for everything
    // else — verified against a live Nest app, not assumed. The first ten
    // annotated controllers reached for @ApiOkResponse everywhere, so 18 create
    // routes told clients their body arrives under 200 when it arrives under
    // 201. A generated client keys the response type off the status code, so it
    // typed every create as returning nothing.
    //
    // This reads the SOURCE rather than the contract, because the contract
    // cannot show the mismatch: it records the status the decorator claimed and
    // has no idea what the route actually returns.
    const offenders: string[] = [];
    for (const file of controllerFiles()) {
      const src = readFileSync(file, 'utf8');
      for (const block of src.match(/@Post\([^)]*\)[\s\S]*?\n {2}[a-zA-Z_]+\(/g) ?? []) {
        if (block.includes('@HttpCode')) continue;
        if (block.includes('ApiOkResponse') || block.includes('ApiPaginatedResponse')) {
          offenders.push(`${file.split('/modules/')[1]}: ${block.split('\n')[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the create routes really are documented under 201 in the contract', () => {
    // The source guard above is the general rule; this is the end-to-end proof
    // that it actually reaches the emitted document.
    const { paths } = loadContract();
    for (const route of ['/tags', '/screens', '/playlists', '/locations']) {
      const post = paths[route]?.post;
      expect(post?.responses?.['201']?.content?.['application/json']?.schema).toBeDefined();
      expect(post?.responses?.['200']).toBeUndefined();
    }
  });

  it('the screenshot list never publishes the storage key', () => {
    // Same rule content follows: the object-storage path is internal, and an
    // image is reachable only through a signed URL that expires.
    const { components } = loadContract();
    const shot = components.schemas.ScreenshotSummaryDto as {
      properties?: Record<string, unknown>;
    };
    const props = Object.keys(shot?.properties ?? {});
    expect(props).not.toContain('storageKey');
    expect(props).toContain('url');
  });

  it('the embedded screenshot is a NARROWER shape than the list row', () => {
    // ScreenshotService.latest returns four fields where list returns six.
    // Sharing one schema would tell a client the monitoring payload carries a
    // file size it never loads — the same trap the playlist split avoids.
    const { components } = loadContract();
    const listRow = components.schemas.ScreenshotSummaryDto as {
      properties?: Record<string, unknown>;
    };
    const embedded = components.schemas.LatestScreenshotDto as {
      properties?: Record<string, unknown>;
    };

    for (const listOnly of ['mimeType', 'fileSizeBytes']) {
      expect(Object.keys(listRow?.properties ?? {})).toContain(listOnly);
      expect(Object.keys(embedded?.properties ?? {})).not.toContain(listOnly);
    }
  });

  it.each([
    ['post', '/auth/logout', 'success'],
    ['post', '/auth/forgot-password', 'success'],
    ['post', '/auth/reset-password', 'success'],
    ['delete', '/users/{id}', 'deleted'],
    ['delete', '/locations/{id}', 'deleted'],
    ['delete', '/playlists/{id}', 'deleted'],
    ['delete', '/schedules/{id}', 'deleted'],
    ['delete', '/tags/{id}', 'deleted'],
    ['post', '/screens/bulk/tags', 'affected'],
    ['post', '/screens/bulk/groups', 'affected'],
    ['put', '/screens/{id}/kiosk-pin', 'updated'],
    ['delete', '/screens/{id}/kiosk-pin', 'reset'],
    ['post', '/content/trash/purge', 'purged'],
    // A SIXTH spelling of "done", found in the next module read after the
    // other five were catalogued. The list was never going to be complete
    // until every controller had been looked at, which is exactly why these
    // are documented as they are rather than unified on sight.
    ['delete', '/scheduled-reports/{id}', 'ok'],
  ])('%s %s acknowledges with `%s`', (method, path, field) => {
    // These thirteen endpoints all "return nothing useful", and the first pass
    // pointed every one of them at SuccessResponseDto. Nine were wrong: they
    // send `deleted`, `affected`, `updated`, `reset` or `purged`, so the
    // contract promised a `success` field that has never existed and hid the
    // one that does. A client checking `res.success` reads undefined and treats
    // a successful delete as a failure.
    //
    // The table is the point. Written as "they all return SuccessResponseDto"
    // this test would restate the bug instead of catching it — each row is
    // copied from the `return` statement that actually runs.
    const { paths, components } = loadContract();
    const schema = (
      paths[path]?.[method] as
        | {
            responses?: Record<
              string,
              { content?: Record<string, { schema?: { $ref?: string } }> }
            >;
          }
        | undefined
    )?.responses?.['200']?.content?.['application/json']?.schema;

    const ref = schema?.$ref;
    expect(ref).toBeDefined();
    const model = components.schemas[ref!.split('/').pop()!] as {
      properties?: Record<string, unknown>;
    };
    expect(Object.keys(model?.properties ?? {})).toEqual([field]);
  });

  it('the invitation shape is pinned, because its view is a SPREAD', () => {
    // Every other DTO here is transcribed from a view that NAMES its fields, so
    // a new column has to be added deliberately. InvitationsService.toView is
    // `const { tokenHash: _omit, ...view }` — add a column to the Prisma model
    // and it starts appearing in responses with nothing in the code changing to
    // say so. An exact match is the only guard that catches that; `not.toContain
    // ('tokenHash')` would pass while a new secret rode in beside it.
    const { components } = loadContract();
    const created = components.schemas.InvitationCreatedDto as {
      properties?: Record<string, unknown>;
    };
    expect(Object.keys(created?.properties ?? {}).sort()).toEqual([
      'acceptedAt',
      'companyId',
      'createdAt',
      'email',
      'expiresAt',
      'id',
      'invitedById',
      'locationIds',
      'revokedAt',
      'role',
      'status',
      // The RAW token, returned only here — the row stores a hash, so this is
      // the one moment it is readable. Deliberate; `tokenHash` is not.
      'token',
      'updatedAt',
    ]);
  });

  it('an impersonation token cannot be extended', () => {
    // start() returns an accessToken and NO refreshToken on purpose: an
    // impersonation is restarted, not renewed, and restarting forces a fresh
    // 2FA code, a fresh reason, and another pair of audit entries. Documenting
    // a refreshToken would invite a client to try.
    const { components } = loadContract();
    const started = components.schemas.ImpersonationStartedDto as {
      properties?: Record<string, unknown>;
    };
    expect(Object.keys(started?.properties ?? {}).sort()).toEqual([
      'accessToken',
      'company',
      'expiresAt',
    ]);
  });

  it.each([
    ['DemoRequestDto', DemoRequestStatus],
    ['RecentCompanyDto', CompanyStatus],
    ['RecentCompanySubscriptionDto', SubscriptionStatus],
    ['ReportDeliveryDto', ReportDeliveryStatus],
  ])('%s documents the real enum members', (schema, prismaEnum) => {
    // Hand-listing these got three of four wrong on the first pass, inventing
    // `PAST_DUE` and `QUALIFIED` alongside real members. Every mistake compiled
    // and emitted. A generated client builds a union from the documented list,
    // so an invented member is a value the client accepts and the API rejects.
    const { components } = loadContract();
    const model = components.schemas[schema] as {
      properties?: Record<string, { enum?: string[] }>;
    };
    expect(model?.properties?.status?.enum?.slice().sort()).toEqual(
      Object.values(prismaEnum).slice().sort(),
    );
  });

  it('the scheduled-report LIST row does not promise the delivery history', () => {
    // GET /scheduled-reports loads no deliveries; only GET /{id} does, and it
    // takes 20. One shared schema would tell a client the list carries a
    // history it never sends — the same split the playlist rows needed.
    const { components } = loadContract();
    const summary = components.schemas.ScheduledReportDto as {
      properties?: Record<string, unknown>;
    };
    const detail = components.schemas.ScheduledReportDetailDto as {
      properties?: Record<string, unknown>;
    };

    expect(Object.keys(summary?.properties ?? {})).not.toContain('deliveries');
    expect(Object.keys(detail?.properties ?? {})).toContain('deliveries');
  });

  it('the report DTO documents the real reportType members', () => {
    // Same reason as the status enums: a generated client builds a union from
    // this list, so an invented member is a value it accepts and the API
    // rejects. reportType is checked separately because the shared enum test
    // keys on a property named `status`.
    const { components } = loadContract();
    const model = components.schemas.ScheduledReportDto as {
      properties?: Record<string, { enum?: string[] }>;
    };
    expect(model?.properties?.reportType?.enum?.slice().sort()).toEqual(
      Object.values(ReportType).slice().sort(),
    );
  });

  it('response coverage does not regress', () => {
    // A RATCHET, not a target: 114 of ~180 operations (auth, users, tags,
    // screen-groups, locations, screens, content, schedules, playlists,
    // companies, emergency, monitoring, super-admin, scheduled-reports). Raise
    // it as controllers are annotated; it fails the moment a route loses its
    // response type. 23 of 38 controllers are still unannotated — that is the
    // remaining work, and this number is how it stays visible rather than
    // forgotten.
    //
    // Measured, never estimated: an earlier version guessed the count and failed
    // on its first run.
    const { annotated, total } = operationsWithResponseSchema();
    expect(annotated.length).toBeGreaterThanOrEqual(114);
    expect(total).toBeGreaterThan(100);
  });
});
