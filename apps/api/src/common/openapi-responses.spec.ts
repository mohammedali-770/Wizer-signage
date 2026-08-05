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

  it('response coverage does not regress', () => {
    // A RATCHET, not a target: 8 of ~180 operations, all in auth. Raise it as
    // controllers are annotated; it fails the moment a route loses its response
    // type. 37 of 38 controllers are still unannotated — that is the remaining
    // work, and this number is how it stays visible rather than forgotten.
    //
    // The 8 is measured, not estimated. An earlier version of this line guessed
    // 9 and failed on the first run.
    const { annotated, total } = operationsWithResponseSchema();
    expect(annotated.length).toBeGreaterThanOrEqual(8);
    expect(total).toBeGreaterThan(100);
  });
});
