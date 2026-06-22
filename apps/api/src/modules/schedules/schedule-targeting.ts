import { Orientation, ScheduleTargetType } from '@prisma/client';

import { dateInRange, utcYmd, windowsOverlap } from '../../common/scheduling/schedule-time.util';

/** Minimal screen shape used for target expansion + orientation checks. */
export interface IndexedScreen {
  id: string;
  locationId: string | null;
  orientation: Orientation;
  groupIds: string[];
}

/** Precomputed company screen index for expanding targets in memory. */
export interface ScreenIndex {
  allScreenIds: string[];
  byId: Map<string, IndexedScreen>;
  byLocation: Map<string, string[]>;
  byGroup: Map<string, string[]>;
}

export interface TargetRef {
  targetType: ScheduleTargetType;
  targetId: string;
}

/** Expand a schedule's targets to the concrete set of screen ids they reach. */
export function expandTargets(targets: TargetRef[], index: ScreenIndex): Set<string> {
  const out = new Set<string>();
  for (const target of targets) {
    switch (target.targetType) {
      case ScheduleTargetType.COMPANY:
        index.allScreenIds.forEach((id) => out.add(id));
        break;
      case ScheduleTargetType.LOCATION:
        (index.byLocation.get(target.targetId) ?? []).forEach((id) => out.add(id));
        break;
      case ScheduleTargetType.SCREEN_GROUP:
        (index.byGroup.get(target.targetId) ?? []).forEach((id) => out.add(id));
        break;
      case ScheduleTargetType.SCREEN:
        if (index.byId.has(target.targetId)) out.add(target.targetId);
        break;
    }
  }
  return out;
}

/** Does a single screen fall under any of a schedule's targets? */
export function screenMatchesTargets(screen: IndexedScreen, targets: TargetRef[]): boolean {
  return targets.some((target) => {
    switch (target.targetType) {
      case ScheduleTargetType.COMPANY:
        return true;
      case ScheduleTargetType.LOCATION:
        return screen.locationId === target.targetId;
      case ScheduleTargetType.SCREEN_GROUP:
        return screen.groupIds.includes(target.targetId);
      case ScheduleTargetType.SCREEN:
        return screen.id === target.targetId;
      default:
        return false;
    }
  });
}

/** Schedule shape needed for conflict + winner computation. */
export interface ConflictSchedule {
  id: string;
  name: string;
  priority: number;
  scheduleType: 'NORMAL' | 'CAMPAIGN';
  updatedAt: Date;
  startDate: Date | null;
  endDate: Date | null;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  daysOfWeek: number[];
}

/** True when two schedules' active date ranges overlap (date-only, inclusive). */
export function dateRangesOverlap(a: ConflictSchedule, b: ConflictSchedule): boolean {
  const aStart = a.startDate ? utcYmd(a.startDate) : null;
  const aEnd = a.endDate ? utcYmd(a.endDate) : null;
  const bStart = b.startDate ? utcYmd(b.startDate) : null;
  const bEnd = b.endDate ? utcYmd(b.endDate) : null;
  // a overlaps b when a starts on/before b ends AND b starts on/before a ends.
  const aStartsBeforeBEnds = bEnd === null || aStart === null || aStart <= bEnd;
  const bStartsBeforeAEnds = aEnd === null || bStart === null || bStart <= aEnd;
  return aStartsBeforeBEnds && bStartsBeforeAEnds;
}

/** Full conflict test: shared screens + overlapping dates + overlapping day/time windows. */
export function schedulesConflict(
  a: ConflictSchedule,
  screensA: Set<string>,
  b: ConflictSchedule,
  screensB: Set<string>,
): { conflicts: boolean; sharedScreenIds: string[] } {
  const shared = [...screensA].filter((id) => screensB.has(id));
  if (shared.length === 0) return { conflicts: false, sharedScreenIds: [] };
  if (!dateRangesOverlap(a, b)) return { conflicts: false, sharedScreenIds: [] };
  const overlap = windowsOverlap(
    a.daysOfWeek,
    a.startTime ?? '00:00',
    a.endTime ?? '00:00',
    a.isAllDay || !a.startTime || !a.endTime,
    b.daysOfWeek,
    b.startTime ?? '00:00',
    b.endTime ?? '00:00',
    b.isAllDay || !b.startTime || !b.endTime,
  );
  if (!overlap) return { conflicts: false, sharedScreenIds: [] };
  return { conflicts: true, sharedScreenIds: shared };
}

/**
 * Which schedule wins where they overlap? Priority desc → CAMPAIGN over NORMAL
 * at equal priority → most recently updated. Returns the winner's id.
 */
export function pickWinner(a: ConflictSchedule, b: ConflictSchedule): string {
  return compareSchedulePrecedence(a, b) <= 0 ? a.id : b.id;
}

/** Negative when `a` outranks `b`. Stable ordering for resolver + conflicts. */
export function compareSchedulePrecedence(a: ConflictSchedule, b: ConflictSchedule): number {
  if (a.priority !== b.priority) return b.priority - a.priority; // higher priority first
  if (a.scheduleType !== b.scheduleType) {
    return a.scheduleType === 'CAMPAIGN' ? -1 : 1; // CAMPAIGN before NORMAL
  }
  return b.updatedAt.getTime() - a.updatedAt.getTime(); // newest first
}

/**
 * Is the schedule active on the given local moment (date + day + time window)?
 *
 * `localYmd` is the screen-local calendar date; `startDate`/`endDate` are
 * calendar-date boundaries stored as UTC midnight, so `utcYmd` recovers the
 * picked date verbatim. We compare calendar-date to calendar-date deliberately:
 * a schedule with startDate "2026-06-15" becomes active the moment the screen's
 * LOCAL date reaches 2026-06-15 (local midnight), regardless of timezone — the
 * intuitive "run this from June 15" behaviour. (Do NOT convert the boundaries
 * into a timezone; that would shift them a day and break this contract.)
 */
export function scheduleActiveAt(
  schedule: ConflictSchedule,
  localYmd: string,
  weekday: number,
  hhmm: string,
): boolean {
  const startYmd = schedule.startDate ? utcYmd(schedule.startDate) : null;
  const endYmd = schedule.endDate ? utcYmd(schedule.endDate) : null;
  if (!dateInRange(localYmd, startYmd, endYmd)) return false;
  if (schedule.daysOfWeek.length && !schedule.daysOfWeek.includes(weekday)) return false;
  if (schedule.isAllDay || !schedule.startTime || !schedule.endTime) return true;
  // timeInWindow handles overnight wrap.
  const start = schedule.startTime;
  const end = schedule.endTime;
  if (start === end) return true;
  if (start < end) return hhmm >= start && hhmm < end;
  return hhmm >= start || hhmm < end;
}
