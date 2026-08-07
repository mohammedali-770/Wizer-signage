import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Request-body coverage in the committed OpenAPI contract.
 *
 * The mirror image of `openapi-responses.spec.ts`, and the half that was left
 * behind. That file opens by noting the contract described "67 request DTOs and
 * ZERO response models" — but "described" was generous. The request DTOs were
 * REFERENCED, not described: every one emitted as `{"type":"object",
 * "properties":{}}`, an empty shell with a name. A client could see exactly what
 * all 209 operations return and essentially nothing about what to send.
 *
 * `@nestjs/swagger` reflects decorator metadata. `class-validator` decorators
 * are not swagger metadata, so `@IsString() @MaxLength(200)` tells the runtime
 * everything and the contract nothing. Documenting a body means adding
 * `@ApiProperty` alongside the validators — and keeping the two honest about
 * each other.
 *
 * The interesting failure this catches is not a missing field. It is a
 * documented constraint that is NARROWER than the one actually enforced: the
 * DTO is only the first gate, and several routes run a second, stricter check in
 * the service. A contract that publishes the first and hides the second sends
 * clients a rule that does not match the 400 they get.
 */

const CONTRACT = join(__dirname, '..', '..', '..', '..', 'contracts', 'openapi.json');

interface Operation {
  tags?: string[];
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: { $ref?: string; properties?: unknown; type?: string } }>;
  };
}

interface Contract {
  paths: Record<string, Record<string, Operation>>;
  components: {
    schemas: Record<string, { properties?: Record<string, unknown>; required?: string[] }>;
  };
}

function loadContract(): Contract {
  try {
    return JSON.parse(readFileSync(CONTRACT, 'utf8')) as Contract;
  } catch (e) {
    throw new Error(
      `Could not read ${CONTRACT}. Regenerate it with: pnpm --filter @wizer/api openapi:emit (${String(e)})`,
    );
  }
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

interface BodyOp {
  key: string;
  tag: string;
  documented: boolean;
}

/**
 * Every operation that accepts a request body, and whether that body is
 * actually described.
 *
 * ANY media type counts, not just `application/json`. One route takes
 * `multipart/form-data`, and measuring only JSON would leave it permanently
 * outstanding — the same unreachable-ceiling bug the response spec hit with its
 * three file-download routes, where no amount of work could reach 100%.
 */
function requestBodies(): BodyOp[] {
  const { paths, components } = loadContract();
  const out: BodyOp[] = [];

  for (const [path, item] of Object.entries(paths)) {
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op?.requestBody) continue;

      const content = op.requestBody.content ?? {};
      const documented = Object.values(content).some(({ schema }) => {
        if (!schema) return false;
        if (schema.$ref) {
          const name = schema.$ref.replace('#/components/schemas/', '');
          return Object.keys(components.schemas[name]?.properties ?? {}).length > 0;
        }
        // An inline schema counts when it says something: named properties, or a
        // scalar body such as a raw string upload.
        return !!schema.properties || schema.type === 'string';
      });

      out.push({
        key: `${method.toUpperCase()} ${path}`,
        tag: op.tags?.[0] ?? '(untagged)',
        documented,
      });
    }
  }
  return out;
}

describe('OpenAPI request-body coverage', () => {
  /**
   * The denominator is PINNED, not derived.
   *
   * A floor on the documented count cannot notice a new undocumented route: add
   * one and the floor still passes. Pinning the total means a new body-taking
   * route fails here until it is either documented or the number is changed
   * deliberately, which is a reviewable act rather than an omission.
   */
  it('measures every operation that takes a request body', () => {
    expect(requestBodies()).toHaveLength(72);
  });

  /**
   * The ratchet. Raise it as modules land; never lower it.
   *
   * Unlike the response side this is still a floor, because the work is in
   * progress. It becomes a completeness assertion — `documented === total` —
   * when the last module lands, and this comment goes with it.
   */
  it('never documents fewer bodies than it did before', () => {
    const documented = requestBodies().filter((o) => o.documented);
    expect(documented.length).toBeGreaterThanOrEqual(26);
  });

  /**
   * Names the offending tag rather than reporting a bare number.
   *
   * The response spec learned this the hard way: a single total let `content`
   * sit at 8/19 and `screens` at 22/29 while both were reported as done. A
   * per-tag table makes a half-finished module visible in the failure message.
   */
  it('reports coverage per tag', () => {
    const perTag = new Map<string, { documented: number; total: number }>();
    for (const op of requestBodies()) {
      const entry = perTag.get(op.tag) ?? { documented: 0, total: 0 };
      entry.total += 1;
      if (op.documented) entry.documented += 1;
      perTag.set(op.tag, entry);
    }

    const complete = [...perTag.entries()]
      .filter(([, v]) => v.documented === v.total)
      .map(([tag]) => tag)
      .sort();

    // Tags finished so far. Listed explicitly so a REGRESSION in a completed
    // module fails, instead of being hidden by progress somewhere else.
    expect(complete).toEqual([
      'auth',
      'companies',
      'company-settings',
      'invitations',
      'locations',
      'notifications',
      'screen-groups',
      'tags',
      'two-factor',
      'users',
    ]);
  });
});

describe('documented constraints match the ones actually enforced', () => {
  const schema = (name: string) => {
    const s = loadContract().components.schemas[name];
    if (!s) throw new Error(`${name} is not in the contract`);
    return s;
  };

  /**
   * The whole reason this file exists.
   *
   * `ResetPasswordDto.password` carries `@MinLength(10)`, so a contract
   * transcribed from the validators alone publishes `minLength: 10`. The real
   * gate is `auth.service.ts` calling `PasswordService.evaluate()`, which also
   * demands upper, lower, digit and symbol, rejects known-common passwords, and
   * blocks immediate reuse. A client that generated a signup form from the
   * published rule would accept `aaaaaaaaaa` and hand the user a 400 it had told
   * them would not happen.
   *
   * The description must therefore carry the FULL policy. This asserts it does,
   * by looking for the parts the validators cannot express.
   */
  it.each([['ResetPasswordDto'], ['AcceptInvitationDto']])(
    '%s tells clients the full password policy, not just the length validator',
    (name) => {
      const desc = String(
        (schema(name).properties?.password as { description?: string })?.description ?? '',
      );
      expect(desc).toMatch(/uppercase/i);
      expect(desc).toMatch(/symbol/i);
      expect(desc).toMatch(/common|breach/i);
    },
  );

  /**
   * `LoginDto.password` deliberately has NO minimum.
   *
   * Login must be able to ATTEMPT any password, including one set before the
   * policy existed. Adding a minimum here looks like consistency and would lock
   * those accounts out of their own sign-in — the failure would appear as
   * "invalid credentials" for a password that is, in fact, correct.
   */
  it('does not impose the password policy on login', () => {
    const password = schema('LoginDto').properties?.password as {
      minLength?: number;
      description?: string;
    };
    expect(password.minLength).toBeUndefined();
    expect(String(password.description)).toMatch(/any password|not.*polic/i);
  });

  /**
   * Optional-vs-required is the single most consequential bit in a request
   * schema, and the easiest to get silently wrong: `@ApiProperty` on a field the
   * DTO treats as optional publishes it as required, and a generated client then
   * refuses to send a legal request.
   */
  /**
   * Two fields that mean "colour", with two different rules.
   *
   * `CreateTagDto.color` is pattern-checked as hex; `CreateCompanyDto
   * .primaryColor` accepts any string up to 20 characters. A client that shares
   * one colour-input component across both screens will validate one of them
   * wrongly. Documented as it is rather than harmonised — changing either is a
   * behaviour change — and pinned so the difference cannot be "tidied" in a
   * later documentation pass without someone deciding to.
   */
  it('keeps the two colour fields honest about disagreeing', () => {
    const tag = schema('CreateTagDto').properties?.color as { pattern?: string };
    const company = schema('CreateCompanyDto').properties?.primaryColor as {
      pattern?: string;
      maxLength?: number;
    };
    expect(tag.pattern).toBe('^#?[0-9A-Fa-f]{3,8}$');
    expect(company.pattern).toBeUndefined();
    expect(company.maxLength).toBe(20);
  });

  /**
   * Array fields that REPLACE rather than append.
   *
   * Sending one id leaves exactly that one, and `[]` clears the set — which is
   * not what "update" suggests, and is destructive if a client read the field
   * as additive. Omitting the field entirely is the no-op; `[]` is not.
   */
  it.each([
    ['UpdateUserDto', 'locationIds'],
    ['UpdateCompanySettingsDto', 'notificationEmails'],
  ])('%s.%s says it replaces the set', (dto, field) => {
    const desc = String(
      (schema(dto).properties?.[field] as { description?: string })?.description ?? '',
    );
    expect(desc).toMatch(/replaces/i);
  });

  it('marks exactly the fields the validators require', () => {
    expect(schema('LoginDto').required?.sort()).toEqual(['email', 'password']);
    expect(schema('AcceptInvitationDto').required?.sort()).toEqual(['name', 'password', 'token']);
    // `currentCode` is conditionally required — on account state, not on shape —
    // so it is correctly OPTIONAL here and enforced in the service.
    expect(schema('BeginTwoFactorSetupDto').required?.sort()).toEqual(['password']);
  });
});
