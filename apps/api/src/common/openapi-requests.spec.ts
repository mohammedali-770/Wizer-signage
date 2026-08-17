import { readdirSync, readFileSync } from 'node:fs';
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

/**
 * Every schema name reachable from a request body, following `$ref` through
 * nested objects, arrays and composition keywords.
 *
 * The coverage measure above only inspects the TOP-LEVEL schema of each body.
 * That is how `WorkingHoursDto` published as `{"type":"object","properties":{}}`
 * while being `$ref`'d from five request bodies: every one of those bodies had
 * properties of its own, so every one counted as documented, and the empty shell
 * nested inside them was never looked at. A client reading the contract was told
 * to send `workingHours: {}` with no way to discover `timezone`, `days`,
 * `outsideHoursBehavior` or `outsideHoursMessage`.
 */
function schemasReachableFromRequestBodies(): Set<string> {
  const { paths, components } = loadContract();
  const seen = new Set<string>();

  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const obj = node as Record<string, unknown>;
    const ref = obj.$ref;
    if (typeof ref === 'string' && ref.startsWith('#/components/schemas/')) {
      const name = ref.replace('#/components/schemas/', '');
      // Guard against a schema that references itself, directly or in a cycle.
      if (seen.has(name)) return;
      seen.add(name);
      walk(components.schemas[name]);
      return;
    }
    Object.values(obj).forEach(walk);
  };

  for (const item of Object.values(paths)) {
    for (const method of HTTP_METHODS) {
      const body = item[method]?.requestBody;
      if (body) walk(body);
    }
  }
  return seen;
}

describe('OpenAPI request-body coverage', () => {
  it('has no empty shell nested inside a documented request body', () => {
    const { components } = loadContract();
    const empty = [...schemasReachableFromRequestBodies()]
      .filter((name) => {
        const schema = components.schemas[name] as
          | { properties?: Record<string, unknown>; enum?: unknown[]; type?: string }
          | undefined;
        if (!schema) return false;
        // A string enum is a complete description without properties.
        if (Array.isArray(schema.enum)) return false;
        if (schema.type && schema.type !== 'object') return false;
        return Object.keys(schema.properties ?? {}).length === 0;
      })
      .sort();

    // Names, not a count: a bare number tells the next reader nothing about
    // which DTO lost its @ApiProperty decorators.
    expect(empty).toEqual([]);
  });

  /**
   * The denominator is PINNED, not derived.
   *
   * A floor on the documented count cannot notice a new undocumented route: add
   * one and the floor still passes. Pinning the total means a new body-taking
   * route fails here until it is either documented or the number is changed
   * deliberately, which is a reviewable act rather than an omission.
   */
  it('measures every operation that takes a request body', () => {
    // 74 = 72 + the two email-confirmation routes (POST /auth/email/confirm,
    // POST /auth/email/resend). This number only ever goes UP by the number of
    // endpoints deliberately added; a drop means a body stopped being emitted.
    expect(requestBodies()).toHaveLength(74);
  });

  /**
   * The ratchet is GONE, replaced by completeness — the work is done.
   *
   * It started as a floor at 4 and was raised as modules landed. A floor was
   * right while the number was climbing and useless at the end: it structurally
   * cannot notice one undocumented body among 72, which is exactly how
   * CreateUrlContentDto stayed half-annotated with every test green. There is no
   * longer a number to raise instead of fixing something.
   */
  it('documents every request body', () => {
    const bodies = requestBodies();
    const undocumented = bodies.filter((o) => !o.documented).map((o) => o.key);
    expect(undocumented).toEqual([]);
    expect(bodies).toHaveLength(74);
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

    // Every tag, not a list to extend. A regression anywhere names its tag.
    const incomplete = [...perTag.entries()]
      .filter(([, v]) => v.documented !== v.total)
      .map(([tag, v]) => `${tag} ${v.documented}/${v.total}`);
    expect(incomplete).toEqual([]);
    expect(complete).toHaveLength(22);
  });
});

/**
 * Partial annotation is invisible to a coverage count.
 *
 * A DTO with ONE annotated field emits a schema with one property, which the
 * measure above reads as "documented" — so a class can be half-done and still
 * count. That is exactly what happened to `CreateUrlContentDto` while this file
 * was being written: `tagIds` and three other fields were silently missing from
 * the contract, and every test passed.
 *
 * A schema cannot reveal a field that is not in it, so this compares against
 * the SOURCE: every property declared on the class must appear in the emitted
 * schema. Crude regex parsing is fine here — these DTOs are flat classes of
 * `name?: type;` declarations, and a false positive fails loudly rather than
 * passing quietly.
 */
describe('annotated DTOs are annotated COMPLETELY', () => {
  const SRC = join(__dirname, '..', 'modules');

  /** Field names declared on a class in a DTO source file. */
  function declaredFields(source: string, className: string): string[] {
    const start = source.indexOf(`export class ${className}`);
    if (start === -1) return [];
    const open = source.indexOf('{', start);
    let depth = 0;
    let end = open;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const body = source.slice(open, end);
    // `  name!: string;` / `  name?: string[];` at one level of indentation.
    return [...body.matchAll(/^ {2}(\w+)[!?]:/gm)].map((m) => m[1] ?? '').filter(Boolean);
  }

  function dtoSources(): Map<string, string> {
    const out = new Map<string, string>();
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.dto.ts')) out.set(full, readFileSync(full, 'utf8'));
      }
    };
    walk(SRC);
    return out;
  }

  /**
   * OpenAPI schema names are GLOBAL, so two classes with the same name collide
   * and one silently overwrites the other.
   *
   * That had already happened: a request body in `public/` and a response model
   * in `super-admin/` were both called `DemoRequestDto`. The response won, so
   * POST /public/demo-request published an admin record — `id`, `status`, `ip`,
   * `userAgent`, `createdAt` — as the body a caller should SEND. Not a missing
   * description: an actively wrong one, and a generated client would be broken
   * by it. Nothing in the emitted document reveals a collision, because by then
   * only the winner is there; the duplicate is only visible in the source.
   */
  it('never declares two DTO classes with the same name', () => {
    const seen = new Map<string, string[]>();
    for (const [file, source] of dtoSources()) {
      for (const m of source.matchAll(/^export class (\w+)/gm)) {
        const name = m[1] ?? '';
        seen.set(name, [...(seen.get(name) ?? []), file]);
      }
    }
    const collisions = [...seen.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([name, files]) => `${name} declared in ${files.length} files`);

    expect(collisions).toEqual([]);
  });

  /**
   * A published constraint the runtime does not enforce.
   *
   * This is the failure mode of the whole exercise, inverted. Writing
   * `maxLength: 60` into `@ApiPropertyOptional` while dropping `@MaxLength(60)`
   * leaves the contract promising a limit the API happily exceeds — an easy
   * edit to make, because the two sit next to each other saying the same thing
   * in different languages. It happened to `CreateScreenDto.code` in this PR and
   * was caught in review, not by a test.
   *
   * `@nestjs/swagger` never checks anything at runtime and `class-validator`
   * never reaches the document, so only a source scan sees the disagreement.
   */
  it('never publishes a string constraint without the validator that enforces it', () => {
    // The decorator may carry extra arguments — `@MinLength(10, { message })`
    // is the same constraint as `@MinLength(10)`, so match the number and the
    // boundary, not the literal string.
    const PAIRS: [string, (v: string) => RegExp][] = [
      ['maxLength', (v) => new RegExp(`@MaxLength\\(\\s*${v}\\s*[,)]`)],
      ['minLength', (v) => new RegExp(`@MinLength\\(\\s*${v}\\s*[,)]`)],
    ];
    const unenforced: string[] = [];

    for (const [file, source] of dtoSources()) {
      const blocks = source.split(/^ {2}(?=@Api(?:Property|PropertyOptional)\()/m).slice(1);
      for (const block of blocks) {
        const field = block.match(/^ {2}(\w+)[!?]:/m)?.[1] ?? '(unknown)';
        for (const [key, decorator] of PAIRS) {
          const declared = block.match(new RegExp(`${key}:\\s*(\\d+)`))?.[1];
          if (!declared) continue;
          const viaLength = /@Length\(\s*\d+\s*,\s*\d+/.test(block);
          if (!decorator(declared).test(block) && !viaLength) {
            unenforced.push(`${file.split('/').pop()} ${field}: ${key} ${declared} not enforced`);
          }
        }
      }
    }

    expect(unenforced).toEqual([]);
  });

  it('emits every declared field of every documented request DTO', () => {
    const { components } = loadContract();
    const sources = [...dtoSources().values()];
    const incomplete: string[] = [];

    for (const [name, schema] of Object.entries(components.schemas)) {
      const emitted = Object.keys(schema.properties ?? {});
      // Only DTOs that have STARTED being annotated; untouched ones are the
      // outstanding work the ratchet already tracks.
      if (emitted.length === 0) continue;

      const source = sources.find((f) => f.includes(`export class ${name}`));
      if (!source) continue;

      const declared = declaredFields(source, name);
      if (declared.length === 0) continue;

      const missing = declared.filter((f) => !emitted.includes(f));
      if (missing.length > 0) incomplete.push(`${name}: missing ${missing.join(', ')}`);
    }

    expect(incomplete).toEqual([]);
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

  /**
   * Required-but-nullable, which a JSON Schema cannot say.
   *
   * `MoveScreenDto.locationId` is `@IsOptional()`, so the schema publishes it as
   * optional — but `screens.service.ts` rejects an ABSENT value with a 400
   * ("locationId is required (use null to unassign)"), because unassigning a
   * screen on an empty body would be a destructive default. `null` and `''`
   * unassign. The only place that truth can live is the description.
   */
  it('warns that MoveScreenDto.locationId must be present despite being optional', () => {
    const prop = schema('MoveScreenDto').properties?.locationId as {
      nullable?: boolean;
      description?: string;
    };
    expect(prop.nullable).toBe(true);
    expect(String(prop.description)).toMatch(/must be present/i);
    expect(schema('MoveScreenDto').required).toBeUndefined();
  });

  /**
   * The same concept, three creation endpoints, two encodings.
   *
   * Multipart cannot carry a JSON array, so the upload takes a COMMA-SEPARATED
   * STRING called `tags` while the URL and TEXT creators take a `tagIds` array.
   * A client sharing one tag-picker across the three has to special-case the
   * upload, and nothing but the contract will tell it so.
   */
  it('keeps the two tag encodings visible', () => {
    const upload = schema('UploadContentDto').properties?.tags as {
      type?: string;
      description?: string;
    };
    const url = schema('CreateUrlContentDto').properties?.tagIds as { type?: string };
    expect(upload.type).toBe('string');
    expect(url.type).toBe('array');
    expect(String(upload.description)).toMatch(/comma-separated/i);
  });

  it('marks exactly the fields the validators require', () => {
    expect(schema('LoginDto').required?.sort()).toEqual(['email', 'password']);
    expect(schema('AcceptInvitationDto').required?.sort()).toEqual(['name', 'password', 'token']);
    // `currentCode` is conditionally required — on account state, not on shape —
    // so it is correctly OPTIONAL here and enforced in the service.
    expect(schema('BeginTwoFactorSetupDto').required?.sort()).toEqual(['password']);
  });
});
