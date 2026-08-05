import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ManifestItem, ScreenPlaybackManifest } from './schedule-resolver.service';

/**
 * The API half of the device-manifest contract (see contracts/README.md).
 *
 * The player and the API were each verified against their OWN idea of the
 * manifest: `ManifestParsingTest` parsed a JSON string typed by hand inside the
 * test file, and the resolver's tests asserted against its own types. Rename
 * `signedUrl` to `signedURL` here and both suites stay green while every screen
 * in the fleet goes blank, because the player parses a manifest whose media
 * fields are all null.
 *
 * These fixtures are the shared bytes that close the gap. This file pins them to
 * the API's types; `ManifestContractTest` on the player parses the same files
 * with `ignoreUnknownKeys = false`.
 *
 * How a rename is caught: the reference values below are declared `satisfies
 * ScreenPlaybackManifest`, so renaming or removing a field stops this file
 * COMPILING. Adding one compiles but fails the key comparison. Either way the
 * fixture has to be regenerated deliberately, and regenerating it is what makes
 * the player's strict parse fail until its model catches up.
 */

const CONTRACTS_DIR = join(__dirname, '..', '..', '..', '..', '..', 'contracts');

function loadFixture(name: string): Record<string, unknown> {
  const path = join(CONTRACTS_DIR, name);
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch (e) {
    // A moved or deleted fixture must fail loudly. Skipping quietly would
    // restore exactly the blind spot this file exists to remove.
    throw new Error(
      `Could not read the manifest contract fixture at ${path}. ` +
        `It is shared with the Android player — see contracts/README.md. (${String(e)})`,
    );
  }
}

/**
 * Every key the API's ManifestItem declares, as a typed value. The `satisfies`
 * clause is the compile-time half of the tripwire.
 */
const REFERENCE_ITEM = {
  contentId: '',
  type: 'IMAGE',
  title: '',
  durationSeconds: 0,
  playFullVideo: false,
  pdfPageDurationSeconds: null,
  orientation: 'LANDSCAPE',
  fileSizeBytes: null,
  checksum: null,
  mimeType: null,
  signedUrl: null,
  downloadPath: null,
  version: '',
  url: null,
  textBody: null,
  metadata: {},
} satisfies ManifestItem;

const REFERENCE_MANIFEST = {
  screenId: '',
  generatedAt: '',
  manifestHash: '',
  timezone: 'UTC',
  sourceType: 'NONE',
  scheduleId: null,
  scheduleName: null,
  playlistId: null,
  playlistTitle: null,
  emergencyBroadcastId: null,
  priority: null,
  outsideHours: false,
  outsideHoursBehavior: null,
  message: null,
  items: [],
  warnings: [],
} satisfies ScreenPlaybackManifest;

const SCHEDULE_FIXTURE = 'device-manifest.schedule.golden.json';
const EMERGENCY_FIXTURE = 'device-manifest.emergency.golden.json';
const FIXTURES = [SCHEDULE_FIXTURE, EMERGENCY_FIXTURE];

describe('device manifest contract', () => {
  it.each(FIXTURES)('%s carries exactly the manifest fields the API declares', (name) => {
    const fixture = loadFixture(name);
    expect(Object.keys(fixture).sort()).toEqual(Object.keys(REFERENCE_MANIFEST).sort());
  });

  it.each(FIXTURES)('%s items carry exactly the item fields the API declares', (name) => {
    const fixture = loadFixture(name);
    const items = fixture.items as Array<Record<string, unknown>>;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(Object.keys(REFERENCE_ITEM).sort());
    }
  });

  it('covers every content type the resolver can emit', () => {
    // A fixture that only exercised IMAGE would let a URL/TEXT-only field drift
    // unnoticed — those items are the ones with null media fields, which is the
    // shape most likely to be mis-modelled on the player.
    const schedule = loadFixture(SCHEDULE_FIXTURE);
    const types = (schedule.items as Array<{ type: string }>).map((i) => i.type);
    expect(types.sort()).toEqual(['IMAGE', 'PDF', 'TEXT', 'URL', 'VIDEO']);
  });

  it('covers both metadata shapes the resolver produces', () => {
    // `{ pageCount }` for PDFs and `{ emergency: true }` for synthetic emergency
    // items. The player models metadata as a typed object, so a shape it does
    // not know is silently discarded in production.
    const schedule = loadFixture(SCHEDULE_FIXTURE);
    const emergency = loadFixture(EMERGENCY_FIXTURE);

    const scheduleMeta = (schedule.items as Array<{ metadata: Record<string, unknown> }>).map(
      (i) => i.metadata,
    );
    expect(scheduleMeta).toContainEqual({ pageCount: 3 });

    const emergencyMeta = (emergency.items as Array<{ metadata: Record<string, unknown> }>).map(
      (i) => i.metadata,
    );
    expect(emergencyMeta).toContainEqual({ emergency: true });
  });

  it('marks emergency items with the synthetic content-id prefix', () => {
    // The player keys on this prefix to report proof-of-play with a null
    // contentId — there is no Content row to reference.
    const emergency = loadFixture(EMERGENCY_FIXTURE);
    const ids = (emergency.items as Array<{ contentId: string }>).map((i) => i.contentId);
    expect(ids.every((id) => id.startsWith('emg:'))).toBe(true);
  });

  it('contains no real hostnames or credentials', () => {
    // These files are committed and read by two CI jobs. Everything in them must
    // stay synthetic; example.com is reserved for documentation (RFC 2606).
    for (const name of FIXTURES) {
      const raw = JSON.stringify(loadFixture(name));
      for (const url of raw.match(/https?:\/\/[^"]+/g) ?? []) {
        expect(url).toMatch(/^https:\/\/[a-z.]*example\.com\//);
      }
    }
  });
});
