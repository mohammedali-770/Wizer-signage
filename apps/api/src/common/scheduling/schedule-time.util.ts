/**
 * Dependency-free, timezone-aware time helpers for the schedule resolver and
 * conflict detection. We avoid a date library: weekday + local clock are derived
 * via `Intl.DateTimeFormat`, and calendar-date boundaries are compared as
 * zero-padded `YYYY-MM-DD` strings (which sort lexicographically).
 *
 * Conventions (see docs/advanced-scheduling.md):
 *  - Day of week: 0 = Sunday … 6 = Saturday.
 *  - Times are "HH:mm" 24h local strings.
 *  - A window with endTime < startTime is an OVERNIGHT window (wraps midnight);
 *    the day-of-week match is evaluated against the window's START day.
 *  - startDate/endDate are calendar dates (time-of-day ignored); a schedule is
 *    in range when the screen-local date is between them, inclusive. Boundary
 *    dates use the stored value's UTC calendar date (date-only is stored as
 *    UTC midnight), which keeps the boundary stable regardless of screen tz.
 */

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export interface LocalMoment {
  /** 0 = Sunday … 6 = Saturday, in the given timezone. */
  weekday: number;
  /** "HH:mm" local clock, 24h. */
  hhmm: string;
  /** "YYYY-MM-DD" local calendar date. */
  ymd: string;
}

/** Resolve the local weekday / clock / date for an instant in a timezone. */
export function localMoment(at: Date, timeZone: string): LocalMoment {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);
  } catch {
    // Unknown timezone → fall back to UTC rather than throwing in the resolver.
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const hour = get('hour') === '24' ? '00' : get('hour'); // some engines emit 24 for midnight
  return {
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
    hhmm: `${hour}:${get('minute')}`,
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

/** The UTC calendar date ("YYYY-MM-DD") of a stored date-only boundary. */
export function utcYmd(date: Date): string {
  const y = date.getUTCFullYear().toString().padStart(4, '0');
  const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = date.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * True when `hhmm` falls within [start, end). Supports overnight windows where
 * end < start (wraps past midnight). start === end is treated as all-day.
 */
export function timeInWindow(hhmm: string, start: string, end: string): boolean {
  if (start === end) return true;
  if (start < end) return hhmm >= start && hhmm < end;
  return hhmm >= start || hhmm < end; // overnight wrap
}

/** True when the local calendar date is within [startYmd, endYmd] inclusive. */
export function dateInRange(
  localYmd: string,
  startYmd: string | null,
  endYmd: string | null,
): boolean {
  if (startYmd && localYmd < startYmd) return false;
  if (endYmd && localYmd > endYmd) return false;
  return true;
}

/** Validate an "HH:mm" 24h string. */
export function isValidHhmm(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * Do two recurring windows overlap on any shared day? Used by conflict
 * detection. Each window is a set of weekdays + a [start,end) time span (with
 * overnight support). Days `[]` means "every day".
 */
export function windowsOverlap(
  daysA: number[],
  startA: string,
  endA: string,
  allDayA: boolean,
  daysB: number[],
  startB: string,
  endB: string,
  allDayB: boolean,
): boolean {
  const sharesDay = sharedDays(daysA, daysB);
  if (!sharesDay) return false;
  if (allDayA || allDayB) return true;
  return timeRangesOverlap(startA, endA, startB, endB);
}

/** Two day sets share a day (an empty set means "every day"). */
export function sharedDays(a: number[], b: number[]): boolean {
  const full = [0, 1, 2, 3, 4, 5, 6];
  const setA = a.length ? a : full;
  const setB = b.length ? b : full;
  return setA.some((d) => setB.includes(d));
}

/** Expand a possibly-overnight [start,end) window into 1-2 same-day spans (minutes). */
function spans(start: string, end: string): Array<[number, number]> {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) return [[0, 1440]]; // all-day
  if (s < e) return [[s, e]];
  return [
    [s, 1440],
    [0, e],
  ]; // overnight → two spans
}

/** Do two (possibly overnight) time windows overlap? */
export function timeRangesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string,
): boolean {
  const a = spans(startA, endA);
  const b = spans(startB, endB);
  return a.some(([as, ae]) => b.some(([bs, be]) => as < be && bs < ae));
}

function toMinutes(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
