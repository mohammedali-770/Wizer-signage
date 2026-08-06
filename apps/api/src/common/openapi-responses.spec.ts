import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  AlertStatus,
  CompanyStatus,
  ScreenStatus,
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
    ['post', '/notifications/{id}/read', 'ok'],
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
    ['AlertDto', AlertStatus],
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

  it('the SEVENTH acknowledgement shape is two of the others at once', () => {
    // POST /notifications/read-all returns `{ ok, updated }`. It is not in the
    // table above because that table asserts a SINGLE key — and this shape is
    // exactly why the table's rule (one endpoint, one spelling) does not hold
    // across the whole API. A client that special-cased `ok`, and one that
    // special-cased `updated`, would each be half right.
    const { paths, components } = loadContract();
    const ref = (
      paths['/notifications/read-all']?.post?.responses?.['200']?.content?.['application/json']
        ?.schema as { $ref?: string } | undefined
    )?.$ref;
    expect(ref).toBe('#/components/schemas/OkUpdatedResponseDto');

    const model = components.schemas.OkUpdatedResponseDto as {
      properties?: Record<string, unknown>;
    };
    expect(Object.keys(model?.properties ?? {}).sort()).toEqual(['ok', 'updated']);
  });

  it.each([
    ['/notifications', 'unreadCount'],
    ['/alerts', 'openCount'],
  ])('%s returns MORE than the pagination envelope', (path, extra) => {
    // Two lists return a count alongside { items, meta }. Applied bare,
    // ApiPaginatedResponse would have documented a two-key object for a
    // three-key response — and the missing key is the one the bell badge and
    // the alert banner actually read. A helper is only safe where it is true;
    // this pins the seam where it stops being true.
    const { paths } = loadContract();
    const schema = paths[path]?.get?.responses?.['200']?.content?.['application/json']?.schema as
      | { properties?: Record<string, unknown>; required?: string[] }
      | undefined;

    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual(['items', 'meta', extra].sort());
    expect(schema?.required).toContain(extra);
  });

  it('the alert shape never publishes the de-duplication state', () => {
    // `dedupeKey` is what stops an unresolved alert re-firing and
    // `lastNotifiedAt` drives the CRITICAL re-notification cadence. Both are
    // server-owned scheduling state; publishing them would invite a client to
    // reason about de-duplication it does not control.
    const { components } = loadContract();
    const alert = components.schemas.AlertDto as { properties?: Record<string, unknown> };
    const props = Object.keys(alert?.properties ?? {});

    for (const internal of ['dedupeKey', 'lastNotifiedAt']) {
      expect(props).not.toContain(internal);
    }
    expect(props).toContain('triggeredAt');
  });

  it('the content preview documents ALL THREE shapes, not just the file one', () => {
    // A URL item returns the URL it points at; a TEXT item returns a body and
    // styling and NO url; a file returns a signed url + mime type. The file
    // shape is the obvious one to document and would have told every client
    // that `url` is always present — for a TEXT item it is never present.
    // Same half-truth POST /auth/login would have told, handled the same way.
    const { paths, components } = loadContract();
    const schema = paths['/content/{id}/preview']?.get?.responses?.['200']?.content?.[
      'application/json'
    ]?.schema as
      | { oneOf?: Array<{ $ref: string }>; discriminator?: { propertyName?: string } }
      | undefined;

    expect((schema?.oneOf ?? []).map((r) => r.$ref.split('/').pop())).toEqual([
      'UrlPreviewDto',
      'TextPreviewDto',
      'FilePreviewDto',
    ]);
    expect(schema?.discriminator?.propertyName).toBe('type');

    // The branch that makes the union necessary.
    const text = components.schemas.TextPreviewDto as { properties?: Record<string, unknown> };
    expect(Object.keys(text?.properties ?? {})).not.toContain('url');
  });

  it('the two byte figures disagree on type, on purpose', () => {
    // `ContentDto.fileSize` is the raw BigInt column and serialises as a
    // STRING. `ContentUsage.storage.usedBytes` is a SUM already passed through
    // Number(), so it is a JSON number. Documenting both as one type would be
    // wrong whichever was chosen, and a client adding them together is the bug
    // this pins — it is the same quantity in two different encodings.
    const { components } = loadContract();
    const content = components.schemas.ContentDto as {
      properties?: Record<string, { type?: string }>;
    };
    const usage = components.schemas.ContentStorageUsageDto as {
      properties?: Record<string, { type?: string }>;
    };

    expect(content?.properties?.fileSize?.type).toBe('string');
    expect(usage?.properties?.usedBytes?.type).toBe('number');
  });

  it('a pairing response never carries the device credential', () => {
    // Pairing mints a device token. It is returned to the DEVICE once, at
    // collection, and never to the dashboard — so none of the three dashboard
    // pairing routes may document one. The device row is the obvious place for
    // such a field to be added by accident.
    const { components } = loadContract();
    const device = components.schemas.PairedDeviceDto as {
      properties?: Record<string, unknown>;
    };
    const props = Object.keys(device?.properties ?? {});

    for (const secret of ['token', 'deviceToken', 'tokenHash', 'refreshTokenHash']) {
      expect(props).not.toContain(secret);
    }
    expect(props).toContain('deviceId');
  });

  it('the screen status enum is the real one', () => {
    // Hand-written, this came out as UNPAIRED/PAIRING/ACTIVE/DISABLED/ARCHIVED:
    // an ACTIVE that does not exist, and ONLINE, OFFLINE and WARNING all
    // missing. Third time in this run that writing an enum from memory produced
    // a wrong one that compiled and emitted.
    const { components } = loadContract();
    const model = components.schemas.PairingStatusDto as {
      properties?: Record<string, { enum?: string[] }>;
    };
    expect(model?.properties?.screenStatus?.enum?.slice().sort()).toEqual(
      Object.values(ScreenStatus).slice().sort(),
    );
  });

  it('the usage evaluation is pinned, because the service returns it WHOLE', () => {
    // GET /companies/{id}/usage returns `usageLimits.evaluate()` directly — no
    // view, no allow-list. That is the same hazard as a spread view: a field
    // added to the UsageEvaluation interface is a field the endpoint starts
    // returning, with nothing in the code saying so. `limits` was nearly missed
    // when this DTO was written; an exact match is what catches the next one.
    const { components } = loadContract();
    const model = components.schemas.UsageEvaluationDto as {
      properties?: Record<string, unknown>;
    };
    expect(Object.keys(model?.properties ?? {}).sort()).toEqual([
      'graceExpired',
      'gracePeriodEndsAt',
      'inGrace',
      'limits',
      'planCode',
      'planName',
      'resources',
      'status',
      'subscriptionStatus',
      'usage',
    ]);
  });

  it('coverage is reported against what CAN be annotated', () => {
    // Five controllers carry @ApiExcludeController and never appear in the
    // contract at all — the device-facing routes (the Android player has its
    // own hand-written client and the golden manifest fixtures), the raw file
    // and download streams. Counting them as "remaining work" overstates what
    // is left and never reaches zero.
    //
    // Measured from the contract rather than narrated in a comment, because
    // the narrated version was wrong twice: it counted excluded controllers as
    // outstanding, and it called modules "done" that had unannotated routes.
    const { paths } = loadContract();
    const perTag: Record<string, { annotated: number; total: number }> = {};
    for (const methods of Object.values(paths)) {
      for (const op of Object.values(methods)) {
        const tag = (op as { tags?: string[] }).tags?.[0] ?? '?';
        const success = op.responses?.['200'] ?? op.responses?.['201'];
        const schema = success?.content?.['application/json']?.schema;
        perTag[tag] ??= { annotated: 0, total: 0 };
        perTag[tag].total += 1;
        if (schema && Object.keys(schema as object).length > 0) perTag[tag].annotated += 1;
      }
    }

    // Tags that are FULLY annotated. A tag listed here that grows a new
    // unannotated route fails immediately — which is the case a plain
    // whole-API floor cannot catch, because one new route among ~180 does not
    // move the total below the ratchet.
    for (const tag of [
      'auth',
      'users',
      'tags',
      'locations',
      'monitoring',
      'super-admin',
      'scheduled-reports',
      'notifications',
      'alerts',
      'content',
      'screens',
      'screen-groups',
      'companies',
    ]) {
      const seen = perTag[tag];
      // Report the tag AND both numbers in the failure, so a break says
      // "screens 22/29" rather than "expected 29, received 22".
      expect({ tag, ...seen }).toEqual({ tag, annotated: seen?.total, total: seen?.total });
    }
  });

  it('response coverage does not regress', () => {
    // A RATCHET, not a target: 145 of the 209 operations in the contract.
    //
    // "172" appeared here one commit ago and was never measured — I carried a
    // number forward instead of counting. The figure below is read off the
    // emitted document, and the assertion under it now pins the denominator so
    // a stale count fails rather than being quoted again. Raise it as controllers are annotated; it fails the moment a
    // route loses its response type.
    //
    // The per-tag test above is the sharper one — this floor cannot notice a
    // single new unannotated route among ~180, and it is why nine tags are
    // pinned at full coverage by name.
    //
    // Measured, never estimated: an earlier version guessed the count and failed
    // on its first run.
    const { annotated, total } = operationsWithResponseSchema();
    expect(annotated.length).toBeGreaterThanOrEqual(145);
    // Pinned, not a floor: the comment above quotes this number, and a quoted
    // number that nothing checks is how the wrong one survived.
    expect(total).toBe(209);
  });
});
