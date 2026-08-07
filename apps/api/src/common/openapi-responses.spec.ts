import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  AlertStatus,
  BillingInterval,
  CompanyStatus,
  InvoiceStatus,
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
 * That work is now DONE: all 209 operations declare a response, across 31 tags.
 * The floor that used to be a ratchet is a completeness assertion, so this spec
 * has changed job — from "make sure it keeps going up" to "make sure it never
 * comes back down". A route added without a response type fails immediately,
 * and there is no longer a number to raise instead of fixing it.
 *
 * Everything else here pins a specific truth the shapes would otherwise lose:
 * which fields a view strips, which endpoints disagree about the type of the
 * same value, and which similar-looking responses must NOT be unified.
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

/**
 * Operations that declare a success response with an actual schema, in ANY
 * media type.
 *
 * It used to look only at `application/json`, which quietly made three routes
 * uncountable: GET /exports/{type} streams CSV/XLSX/PDF, and the import
 * template and proof-of-play export stream CSV. They have no JSON body and
 * never will, so a JSON-only measure had a ceiling it could not reach and
 * reported them forever as outstanding work. They are now documented with
 * their real content types and counted like everything else.
 */
function operationsWithResponseSchema(): { annotated: string[]; total: number } {
  const { paths } = loadContract();
  const annotated: string[] = [];
  let total = 0;

  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(methods)) {
      total += 1;
      const success = op.responses?.['200'] ?? op.responses?.['201'];
      const described = Object.values(success?.content ?? {}).some(
        (media) => media.schema && Object.keys(media.schema as object).length > 0,
      );
      if (described) annotated.push(`${method.toUpperCase()} ${path}`);
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
    // Renamed from DemoRequestDto: that name collided with the PUBLIC request
    // body of the same name, and since OpenAPI schema names are global one
    // silently overwrote the other. This response model won, so
    // POST /public/demo-request was publishing an admin record — id, status,
    // ip, userAgent — as the body a caller should SEND.
    ['AdminDemoRequestDto', DemoRequestStatus],
    ['RecentCompanyDto', CompanyStatus],
    ['RecentCompanySubscriptionDto', SubscriptionStatus],
    ['ReportDeliveryDto', ReportDeliveryStatus],
    ['AlertDto', AlertStatus],
    ['InvoiceDto', InvoiceStatus],
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

  /**
   * Byte counts agree on type, like money does.
   *
   * This test used to assert the OPPOSITE — that `ContentDto.fileSize` was a
   * string and `usedBytes` a number, "on purpose". It was not on purpose: the
   * sum went through `Number()` and the per-row column did not, so the same
   * quantity had two encodings and a client adding them together was wrong.
   *
   * It was also actively dangerous while it stood. When `storageBytes` became a
   * string, `ContentService.usageSummary` copied that value straight into
   * `usedBytes` — so the API returned a string while the contract still said
   * number, and THIS TEST kept passing because it was pinning the stale type.
   * A guard that asserts the wrong invariant protects the bug.
   *
   * Stated positively now, over every byte total rather than one pair.
   */
  it('every byte figure is a string, everywhere', () => {
    const { components } = loadContract();
    const BYTES = /^(fileSize|fileSizeBytes|usedBytes|storageBytes|sizeBytes)$/;
    const numeric: string[] = [];

    for (const [name, schema] of Object.entries(components.schemas)) {
      // Request shapes may take a number — a caller sends a plain integer.
      if (/^(Create|Update|Record)/.test(name)) continue;
      const props = (schema as { properties?: Record<string, { type?: string }> }).properties ?? {};
      for (const [field, prop] of Object.entries(props)) {
        if (BYTES.test(field) && prop.type === 'number') numeric.push(`${name}.${field}`);
      }
    }

    expect(numeric).toEqual([]);

    // `usedGb` stays a NUMBER: it is a derived display figure, not an exact
    // quantity, and nothing sums it against a 64-bit column.
    const usage = components.schemas.ContentStorageUsageDto as {
      properties?: Record<string, { type?: string }>;
    };
    expect(usage?.properties?.usedGb?.type).toBe('number');
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

  it.each([
    ['PlanDto', 'priceMonthly'],
    ['PlanDto', 'priceYearly'],
    ['InvoiceDto', 'subtotal'],
    ['InvoiceDto', 'tax'],
    ['InvoiceDto', 'total'],
  ])('%s.%s is documented as a STRING, because Decimal serialises as one', (schema, field) => {
    // Verified against Prisma rather than assumed:
    //   JSON.stringify({ p: new Prisma.Decimal('49.90') })  ->  {"p":"49.9"}
    // Two things follow. Money is a string, and `49.90` comes back as "49.9" —
    // a client cannot rely on two decimal places and must format for display.
    //
    // Documenting these as `number` would tell a generated client to hand back
    // a value that arrives quoted, and every arithmetic call on it would be on
    // a string.
    const { components } = loadContract();
    const model = components.schemas[schema] as {
      properties?: Record<string, { type?: string }>;
    };
    expect(model?.properties?.[field]?.type).toBe('string');
  });

  /**
   * EVERY money field is a string, on every endpoint.
   *
   * This test used to assert the opposite — that `InvoiceDto.total` was a string
   * while `unpaidTotal` was a number, and that the split was deliberate. It was
   * not deliberate, it was an accident of one `_sum` being passed through
   * `Number()`; the same accident made the public plan price a number while the
   * admin one was a string. A Decimal cannot round-trip through a JS float
   * exactly, and this is billing data.
   *
   * The invariant is now stated positively, over the whole contract rather than
   * a hand-picked pair, so a fourth encoding cannot be introduced anywhere
   * without failing here.
   */
  it('every money field is a string, everywhere', () => {
    const { components } = loadContract();

    // Currency fields only. `total` is deliberately NOT in this list: it names
    // a page count on PageMetaDto and a headcount on four others, so matching
    // it by name alone would flag six integers that are not money. Invoice
    // totals are covered explicitly below.
    const MONEY = /^(price|priceMonthly|priceYearly|unpaidTotal|subtotal|tax|unitPrice)$/;

    // Request shapes legitimately take a NUMBER: a JSON body has no decimal
    // type, so a client sends 49.9 and reads back "49.90". InvoiceLineItemDto is
    // nested inside CreateInvoiceDto and is a request shape despite the name.
    const isRequest = (name: string) =>
      /^(Create|Update)/.test(name) || name === 'InvoiceLineItemDto';

    const numeric: string[] = [];
    for (const [name, schema] of Object.entries(components.schemas)) {
      if (isRequest(name)) continue;
      const props = (schema as { properties?: Record<string, { type?: string }> }).properties ?? {};
      for (const [field, prop] of Object.entries(props)) {
        if (MONEY.test(field) && prop.type === 'number') numeric.push(`${name}.${field}`);
      }
    }
    expect(numeric).toEqual([]);

    // The invoice money that `total` would have covered, named directly.
    const invoice = components.schemas.InvoiceDto as {
      properties?: Record<string, { type?: string }>;
    };
    const unpaid = components.schemas.UnpaidInvoicesDto as {
      properties?: Record<string, { type?: string }>;
    };
    expect(invoice?.properties?.total?.type).toBe('string');
    expect(unpaid?.properties?.unpaidTotal?.type).toBe('string');
  });

  it('POST /subscriptions is the one route whose response has no company', () => {
    // `create` includes only { plan: true }; every read, update and cancel also
    // includes the company summary. One shared class would tell a client that
    // `company` is always present — on the create response it never is.
    const { components } = loadContract();
    const created = components.schemas.SubscriptionDto as {
      properties?: Record<string, unknown>;
    };
    const read = components.schemas.SubscriptionWithCompanyDto as {
      properties?: Record<string, unknown>;
    };

    expect(Object.keys(created?.properties ?? {})).not.toContain('company');
    expect(Object.keys(read?.properties ?? {})).toContain('company');
    // Both carry the plan — create includes it too.
    expect(Object.keys(created?.properties ?? {})).toContain('plan');
  });

  it('the plan billing interval is the real enum', () => {
    const { components } = loadContract();
    const model = components.schemas.PlanDto as {
      properties?: Record<string, { enum?: string[] }>;
    };
    expect(model?.properties?.billingInterval?.enum?.slice().sort()).toEqual(
      Object.values(BillingInterval).slice().sort(),
    );
  });

  it('the session shape is pinned, because its view is a SPREAD too', () => {
    // `const { refreshTokenHash, previousRefreshTokenHash, ...view } = session`.
    // Second spread view found (invitations was the first): a new Session
    // column joins this response with nothing in the code saying so. Both
    // removed fields are live credentials — the current refresh-token hash and
    // the one still accepted inside the rotation grace window.
    const { components } = loadContract();
    const model = components.schemas.SessionDto as { properties?: Record<string, unknown> };
    expect(Object.keys(model?.properties ?? {}).sort()).toEqual([
      'companyId',
      'createdAt',
      // Added by the view, not a column: which row is the caller's own.
      'current',
      'expiresAt',
      'id',
      'impersonationNote',
      'impersonatorId',
      'ip',
      'lastActiveAt',
      'mfaSatisfied',
      'refreshRotatedAt',
      'revokedAt',
      'revokedReason',
      'userAgent',
      'userId',
    ]);
  });

  it('`revoked` never means two things — the count is revokedCount', () => {
    // Same key, two types, on sibling routes of the same controller:
    //   DELETE /sessions/others            -> { revoked: 3 }
    //   POST   /sessions/users/{id}/terminate -> { revoked: 3 }
    //   DELETE /sessions/{id}              -> { revoked: true }
    // A client reading `res.revoked` for truthiness happens to work; one that
    // displays it or compares it to a number does not. The contract shows the
    // collision rather than averaging it away — and this test is what stops
    // someone "tidying" the two DTOs into one.
    const { paths, components } = loadContract();
    const refOf = (method: string, path: string) =>
      (
        paths[path]?.[method]?.responses?.['200']?.content?.['application/json']?.schema as
          | { $ref?: string }
          | undefined
      )?.$ref
        ?.split('/')
        .pop();

    expect(refOf('delete', '/sessions/others')).toBe('RevokedCountDto');
    expect(refOf('post', '/sessions/users/{userId}/terminate')).toBe('RevokedCountDto');
    expect(refOf('delete', '/sessions/{id}')).toBe('RevokedFlagDto');

    const count = components.schemas.RevokedCountDto as {
      properties?: Record<string, { type?: string }>;
    };
    const flag = components.schemas.RevokedFlagDto as {
      properties?: Record<string, { type?: string }>;
    };

    // The collision is FIXED: the count is `revokedCount`, the flag is
    // `revoked`. This used to assert the two types under one key, which was the
    // honest thing to pin while the collision stood. Now it pins the opposite —
    // that no key carries both meanings — so re-introducing the clash fails.
    expect(count?.properties?.revokedCount?.type).toBe('number');
    expect(count?.properties?.revoked).toBeUndefined();
    expect(flag?.properties?.revoked?.type).toBe('boolean');
    expect(flag?.properties?.revokedCount).toBeUndefined();
  });

  it('the 2FA enrollment secret is documented as the credential it is', () => {
    // POST /auth/2fa/setup returns the TOTP secret in PLAINTEXT — it has to,
    // the user is enrolling an authenticator. But "the setup endpoint returns a
    // secret" is easy to skim past when reviewing what an endpoint may expose,
    // so the contract says it out loud. This asserts the warning is actually
    // published, not just present in a source comment a reader never sees.
    const { components } = loadContract();
    const setup = components.schemas.TwoFactorSetupDto as {
      properties?: Record<string, { description?: string }>;
    };
    expect(Object.keys(setup?.properties ?? {}).sort()).toEqual([
      'otpauthUrl',
      'qrCodeDataUrl',
      'secret',
    ]);
    expect(setup?.properties?.secret?.description).toMatch(/credential/i);
    // The QR and the URI carry the same secret; neither may be described as safe.
    expect(setup?.properties?.otpauthUrl?.description).toMatch(/same secret/i);
  });

  it('only the token-minting invitation routes document a token', () => {
    // create and resend mint a raw token and return it; list and revoke must
    // not be documented as maybe-returning one.
    const { paths, components } = loadContract();
    const created = components.schemas.InvitationCreatedDto as {
      properties?: Record<string, unknown>;
    };
    const plain = components.schemas.InvitationDto as { properties?: Record<string, unknown> };
    expect(Object.keys(created?.properties ?? {})).toContain('token');
    expect(Object.keys(plain?.properties ?? {})).not.toContain('token');

    const listItems = (
      paths['/invitations']?.get?.responses?.['200']?.content?.['application/json']?.schema as
        | { properties?: { items?: { items?: { $ref?: string } } } }
        | undefined
    )?.properties?.items?.items?.$ref;
    expect(listItems).toBe('#/components/schemas/InvitationDto');
  });

  it('the three `validate` endpoints agree on almost nothing', () => {
    // Three endpoints with the same name and three different shapes:
    //
    //   schedules  -> schedulable, playlist, targetCount, orientationWarnings,
    //                 conflicts, warnings          (no `valid`, no `errors`)
    //   playlists  -> valid, schedulable, itemCount, ..., issues, warnings
    //   emergency  -> valid, canActivate, errors, warnings, affectedScreens
    //
    // The ONLY field all three share is `warnings`. A single shared
    // ValidationResultDto is the obvious tidy-up and would be wrong for all
    // three — this is the test that makes it fail rather than quietly ship.
    const { components } = loadContract();
    const props = (name: string) =>
      Object.keys(
        (components.schemas[name] as { properties?: Record<string, unknown> })?.properties ?? {},
      );

    const schedule = props('ScheduleValidationDto');
    const playlist = props('PlaylistValidationDto');
    const emergency = props('EmergencyValidationDto');

    const shared = schedule.filter((f) => playlist.includes(f) && emergency.includes(f));
    expect(shared).toEqual(['warnings']);

    // Only the schedule one lacks `valid`; only emergency has `errors` and
    // `canActivate`. Each asserted so a drift in either direction fails.
    expect(schedule).not.toContain('valid');
    expect(playlist).toContain('valid');
    expect(emergency).toContain('valid');
    expect(emergency).toContain('canActivate');
    expect(schedule).not.toContain('errors');
    expect(playlist).not.toContain('errors');
    expect(emergency).toContain('errors');
  });

  it('GET /schedules/conflicts is an object, not the array its name suggests', () => {
    // The endpoint is `conflicts` and the field inside is `conflicts`. That is
    // exactly how it gets documented as a bare array by someone reading the
    // route name and not the return statement.
    const { paths } = loadContract();
    const schema = paths['/schedules/conflicts']?.get?.responses?.['200']?.content?.[
      'application/json'
    ]?.schema as { $ref?: string; type?: string } | undefined;

    expect(schema?.type).not.toBe('array');
    expect(schema?.$ref).toBe('#/components/schemas/ScheduleConflictsDto');
  });

  /**
   * The public plan row and the admin one now AGREE on money, and still differ
   * on everything else.
   *
   * They used to disagree: `GET /public/plans` mapped each row through
   * `Number(p.priceMonthly)` while `GET /plans` returned the raw Decimal. Same
   * table, same field name, two types — a client sharing one Plan type across
   * the marketing site and the admin dashboard was wrong on one of them.
   *
   * The narrowness of the public row is a SEPARATE and deliberate thing, and is
   * still pinned: it is not the admin row with a different price type.
   */
  it('the public plan row agrees on money and stays narrower', () => {
    const { components } = loadContract();
    const pub = components.schemas.PublicPlanDto as {
      properties?: Record<string, { type?: string }>;
    };
    const admin = components.schemas.PlanDto as {
      properties?: Record<string, { type?: string }>;
    };

    expect(pub?.properties?.priceMonthly?.type).toBe('string');
    expect(admin?.properties?.priceMonthly?.type).toBe('string');

    for (const adminOnly of ['isActive', 'isPublic', 'billingInterval', 'createdAt']) {
      expect(Object.keys(pub?.properties ?? {})).not.toContain(adminOnly);
    }
  });

  it('a health probe documents its BODY, not just that a 200 happens', () => {
    // Both routes already carried `@ApiResponse({ status: 200, description })`,
    // which says a 200 occurs and nothing about what is in it — a generated
    // client got `unknown`, and the routes still counted as unannotated. A
    // description is not a schema.
    const { paths } = loadContract();
    const ok = paths['/health']?.get?.responses?.['200']?.content?.['application/json']?.schema;
    expect(ok).toBeDefined();

    // The 503 carries the same shape, with status `degraded` — a caller that
    // only reads the 200 will never see that value.
    const notReady =
      paths['/health/ready']?.get?.responses?.['503']?.content?.['application/json']?.schema;
    expect(notReady).toBeDefined();
  });

  it('the playback manifest agrees with the golden fixtures', () => {
    // This is the one response shape that already had an independent guard:
    // contracts/device-manifest.*.golden.json are parsed by BOTH the API spec
    // and the player's ManifestContractTest, so a renamed field fails the
    // Kotlin build rather than blanking a fleet quietly. The DTO must not
    // drift from those files — this checks the item keys line up.
    const { components } = loadContract();
    const item = components.schemas.ManifestItemDto as {
      properties?: Record<string, unknown>;
    };
    const golden = JSON.parse(
      readFileSync(
        join(
          __dirname,
          '..',
          '..',
          '..',
          '..',
          'contracts',
          'device-manifest.schedule.golden.json',
        ),
        'utf8',
      ),
    ) as { items: Record<string, unknown>[] };

    expect(Object.keys(item?.properties ?? {}).sort()).toEqual(
      Object.keys(golden.items[0] ?? {}).sort(),
    );
  });

  it('EVERY operation in the contract declares what it returns', () => {
    // This started as a ratchet — 8 of ~180, raise it as you go. It is now a
    // completeness assertion: all 209 operations declare a response schema.
    //
    // The floor stayed useful the whole way up, but it could never have
    // finished the job on its own. It cannot notice one new unannotated route
    // among 209, which is why the per-tag test above exists and why two
    // modules sat at 8/19 and 22/29 while being reported as done. Now that the
    // number is total, the strict equality is the guard: a route added without
    // a response type fails here immediately, and there is no "raise the
    // number" escape.
    const { annotated, total } = operationsWithResponseSchema();
    expect(total).toBe(209);
    expect(annotated.length).toBe(total);
  });

  it('the per-tag view is complete too, so no tag can regress quietly', () => {
    // Guards the same property from the other direction: `annotated === total`
    // overall would still hold if one tag lost a route and another gained one.
    const { paths } = loadContract();
    const incomplete: string[] = [];
    const perTag: Record<string, { annotated: number; total: number }> = {};

    for (const methods of Object.values(paths)) {
      for (const op of Object.values(methods)) {
        const tag = (op as { tags?: string[] }).tags?.[0] ?? '?';
        const success = op.responses?.['200'] ?? op.responses?.['201'];
        const described = Object.values(success?.content ?? {}).some(
          (media) => media.schema && Object.keys(media.schema as object).length > 0,
        );
        perTag[tag] ??= { annotated: 0, total: 0 };
        perTag[tag].total += 1;
        if (described) perTag[tag].annotated += 1;
      }
    }
    for (const [tag, v] of Object.entries(perTag)) {
      if (v.annotated < v.total) incomplete.push(`${tag} ${v.annotated}/${v.total}`);
    }
    expect(incomplete).toEqual([]);
    // 31 tags. Pinned so a whole tag vanishing (a controller excluded by
    // mistake) is a failure rather than a silently smaller, still-green set.
    expect(Object.keys(perTag).length).toBe(31);
  });
});
