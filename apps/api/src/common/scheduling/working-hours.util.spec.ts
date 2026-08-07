import { OutsideHoursBehavior } from '../dto/working-hours.dto';
import { evaluateWorkingHours } from './working-hours.util';

/**
 * `evaluateWorkingHours` reads JSON written by past versions of the API, which
 * makes its behaviour-normalisation a compatibility surface rather than a
 * formality: working hours live in a JSON column on Location, Screen and
 * Company, so no migration has ever rewritten a stored value.
 *
 * The case that matters is `"SLEEP"`, renamed to `BLANK_SCREEN`. If the rename
 * had simply dropped the old string, every screen configured before it would
 * have fallen through to `FALLBACK` — a venue that went dark outside opening
 * hours would have started showing fallback content instead, with nothing in
 * any log to say why.
 */

const AT = new Date('2026-08-07T22:00:00.000Z'); // a Friday, 22:00 UTC
const CLOSED_ALL_WEEK = Array.from({ length: 7 }, (_, day) => ({ day, closed: true }));

const outsideHours = (behavior: unknown) =>
  evaluateWorkingHours(
    { days: CLOSED_ALL_WEEK, outsideHoursBehavior: behavior as never },
    AT,
    'UTC',
  );

describe('evaluateWorkingHours — behaviour normalisation', () => {
  it('maps the legacy "SLEEP" to BLANK_SCREEN, not to the FALLBACK default', () => {
    const result = outsideHours('SLEEP');
    expect(result.withinHours).toBe(false);
    expect(result.behavior).toBe(OutsideHoursBehavior.BLANK_SCREEN);
    // The specific regression: silently becoming FALLBACK would change what a
    // deployed screen displays without any configuration having been edited.
    expect(result.behavior).not.toBe(OutsideHoursBehavior.FALLBACK);
  });

  it.each([
    OutsideHoursBehavior.FALLBACK,
    OutsideHoursBehavior.BLACK_SCREEN,
    OutsideHoursBehavior.CUSTOM_MESSAGE,
    OutsideHoursBehavior.BLANK_SCREEN,
  ])('passes %s through unchanged', (behavior) => {
    expect(outsideHours(behavior).behavior).toBe(behavior);
  });

  it('still falls back for values that mean nothing', () => {
    // Not over-broad: an unrecognised string must NOT be waved through just
    // because the legacy branch exists.
    for (const junk of ['sleep', 'BLANK', 'POWER_OFF', '', null, undefined, 42, {}]) {
      expect(outsideHours(junk).behavior).toBe(OutsideHoursBehavior.FALLBACK);
    }
  });

  it('the enum no longer offers SLEEP as a choice', () => {
    // The rename is only half done if the old name is still selectable: the
    // point was to stop promising hardware sleep the player cannot perform.
    expect(Object.values(OutsideHoursBehavior)).not.toContain('SLEEP');
    expect(Object.values(OutsideHoursBehavior)).toContain('BLANK_SCREEN');
  });

  it('reports the behaviour even when inside hours, since callers read it either way', () => {
    const open = evaluateWorkingHours(
      {
        days: Array.from({ length: 7 }, (_, day) => ({ day, closed: false })),
        outsideHoursBehavior: 'SLEEP' as never,
      },
      AT,
      'UTC',
    );
    expect(open.withinHours).toBe(true);
    expect(open.behavior).toBe(OutsideHoursBehavior.BLANK_SCREEN);
  });
});
