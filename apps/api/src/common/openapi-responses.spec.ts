import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

  it('response coverage does not regress', () => {
    // A RATCHET, not a target: 73 of ~180 operations (auth, users, tags,
    // screen-groups, locations, screens, content, schedules, playlists,
    // companies). Raise it as
    // controllers are annotated; it fails the moment a route loses its response
    // type. 28 of 38 controllers are still unannotated — that is the remaining
    // work, and this number is how it stays visible rather than forgotten.
    //
    // Measured, never estimated: an earlier version guessed the count and failed
    // on its first run.
    const { annotated, total } = operationsWithResponseSchema();
    expect(annotated.length).toBeGreaterThanOrEqual(73);
    expect(total).toBeGreaterThan(100);
  });
});
