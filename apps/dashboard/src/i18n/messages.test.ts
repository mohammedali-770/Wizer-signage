import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { messagesForGroup, sharedMessages, type Messages, type RouteGroup } from './messages.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..');
const MESSAGES = join(SRC, '..', 'messages');

const en = JSON.parse(readFileSync(join(MESSAGES, 'en.json'), 'utf8')) as Messages;

/**
 * Does `namespace` actually resolve inside this slice?
 *
 * Walks the dotted path rather than checking membership in a flattened set. An
 * earlier version accepted any ANCESTOR — which meant every `pages.*` namespace
 * passed simply because `pages` existed as a container, so dropping
 * `pages.login` from the shared slice went undetected. `useTranslations('a.b')`
 * needs `messages.a.b` to exist, and nothing less.
 */
function resolves(slice: Messages, namespace: string): boolean {
  let node: unknown = slice;
  for (const part of namespace.split('.')) {
    if (!node || typeof node !== 'object') return false;
    if (!(part in (node as Record<string, unknown>))) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return node !== undefined;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

/**
 * Every namespace a directory tree references.
 *
 * BOTH call shapes matter, and missing the second is how a split ships raw keys:
 *
 *   useTranslations('pages.screens')  → the namespace is the argument
 *   useTranslations()  + t('marketing.hero.title')
 *                                     → the namespace is the key's own prefix
 *
 * The marketing pages use the second form exclusively, so an extractor that only
 * understood the first would report that they need nothing at all and happily
 * approve a slice that renders the entire public site as dotted keys.
 */
function namespacesUsedIn(dir: string): Set<string> {
  const found = new Set<string>();
  for (const file of walk(dir)) {
    const source = readFileSync(file, 'utf8');

    for (const m of source.matchAll(/(?:use|get)Translations\(\s*'([^']+)'/g)) {
      found.add(m[1]!);
    }
    // Bare useTranslations(): every t('a.b…') in the file names its own root.
    if (/(?:use|get)Translations\(\s*\)/.test(source)) {
      for (const m of source.matchAll(/\bt\(\s*'([A-Za-z][A-Za-z0-9]*)\.[^']*'/g)) {
        found.add(m[1]!);
      }
    }
  }
  return found;
}

const GROUP_DIRS: Record<RouteGroup, string> = {
  marketing: join(SRC, 'app', '[locale]', '(marketing)'),
  admin: join(SRC, 'app', '[locale]', 'admin'),
  company: join(SRC, 'app', '[locale]', 'company'),
};

// Rendered inside every group's provider, so their namespaces must be in the
// shared slice rather than any one group's.
const ALWAYS_RENDERED = [join(SRC, 'components'), join(SRC, 'providers')].filter((d) => {
  try {
    return statSync(d).isDirectory();
  } catch {
    return false;
  }
});

describe('message slices cover what the source actually uses', () => {
  for (const [group, dir] of Object.entries(GROUP_DIRS) as [RouteGroup, string][]) {
    it(`${group} routes have every namespace they reference`, () => {
      const slice = messagesForGroup(en, group);
      const missing = [...namespacesUsedIn(dir)].filter((ns) => !resolves(slice, ns));
      assert.deepEqual(missing, [], `${group} slice is missing: ${missing.join(', ')}`);
    });
  }

  it('shared components have every namespace they reference', () => {
    // These render inside all three groups, so a gap here breaks every route.
    const slice = sharedMessages(en);
    const used = new Set<string>();
    for (const dir of ALWAYS_RENDERED) for (const ns of namespacesUsedIn(dir)) used.add(ns);
    const missing = [...used].filter((ns) => !resolves(slice, ns));
    assert.deepEqual(missing, [], `shared slice is missing: ${missing.join(', ')}`);
  });

  it('login and accept-invitation are served by the shared slice alone', () => {
    // Neither route has a group layout, so the root provider is all they get.
    const slice = sharedMessages(en);
    const used = new Set<string>();
    for (const leaf of ['login', 'accept-invitation']) {
      for (const ns of namespacesUsedIn(join(SRC, 'app', '[locale]', leaf))) used.add(ns);
    }
    const missing = [...used].filter((ns) => !resolves(slice, ns));
    assert.deepEqual(missing, [], `shared slice is missing: ${missing.join(', ')}`);
  });
});

describe('message slices are actually smaller', () => {
  const bytes = (o: unknown) => Buffer.byteLength(JSON.stringify(o));

  it('the shared slice is a fraction of the whole catalogue', () => {
    // The plan's complaint: a six-key login page shipping the entire catalogue.
    assert.ok(
      bytes(sharedMessages(en)) < bytes(en) * 0.3,
      `shared slice is ${bytes(sharedMessages(en))}B of ${bytes(en)}B`,
    );
  });

  it('no group ships the marketing site', () => {
    for (const group of ['admin', 'company'] as RouteGroup[]) {
      assert.equal(
        (messagesForGroup(en, group) as Record<string, unknown>).marketing,
        undefined,
        `${group} still ships marketing copy`,
      );
    }
  });

  it('admin does not ship company page copy, and vice versa', () => {
    const adminPages = Object.keys(
      (messagesForGroup(en, 'admin').pages ?? {}) as Record<string, unknown>,
    );
    const companyPages = Object.keys(
      (messagesForGroup(en, 'company').pages ?? {}) as Record<string, unknown>,
    );
    assert.ok(adminPages.includes('adminOverview'));
    assert.ok(!adminPages.includes('screens'), 'admin slice leaked company pages');
    assert.ok(companyPages.includes('screens'));
    assert.ok(!companyPages.includes('adminOverview'), 'company slice leaked admin pages');
  });

  it('every locale has the same namespace shape, so no locale is short-changed', () => {
    const ar = JSON.parse(readFileSync(join(MESSAGES, 'ar.json'), 'utf8')) as Messages;
    for (const group of ['marketing', 'admin', 'company'] as RouteGroup[]) {
      assert.deepEqual(
        Object.keys(messagesForGroup(ar, group)).sort(),
        Object.keys(messagesForGroup(en, group)).sort(),
        `${group} slice differs between en and ar`,
      );
    }
  });
});
