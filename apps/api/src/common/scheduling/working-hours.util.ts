import { OutsideHoursBehavior } from '../dto/working-hours.dto';
import { localMoment, timeInWindow } from './schedule-time.util';

/** Loosely-typed shape of the working-hours JSON stored on Screen/Location/Company. */
export interface WorkingHoursConfig {
  timezone?: string | null;
  days?: Array<{
    day: number;
    closed: boolean;
    open?: string | null;
    close?: string | null;
  }> | null;
  outsideHoursBehavior?: OutsideHoursBehavior | string | null;
  outsideHoursMessage?: string | null;
}

export interface WorkingHoursEvaluation {
  /** True when playback is allowed at the evaluated instant. */
  withinHours: boolean;
  /** What to show when outside hours (only meaningful when withinHours is false). */
  behavior: OutsideHoursBehavior;
  message: string | null;
}

/**
 * Evaluate whether `at` falls within the configured active hours, in the given
 * timezone. A null/empty config (or no day entries) means "always on" (24/7).
 * When a `days` array is present, a missing or `closed` entry for the current
 * weekday is treated as outside-hours; a non-closed entry with no open/close
 * pair is treated as all-day open.
 */
export function evaluateWorkingHours(
  config: WorkingHoursConfig | null | undefined,
  at: Date,
  timeZone: string,
): WorkingHoursEvaluation {
  const behavior = normalizeBehavior(config?.outsideHoursBehavior);
  const message = config?.outsideHoursMessage ?? null;

  const days = config?.days;
  if (!config || !days || days.length === 0) {
    return { withinHours: true, behavior, message };
  }

  const { weekday, hhmm } = localMoment(at, config.timezone || timeZone);
  const entry = days.find((d) => d.day === weekday);
  if (!entry || entry.closed) {
    return { withinHours: false, behavior, message };
  }
  if (!entry.open || !entry.close) {
    // Open day with no explicit window → treated as all-day open.
    return { withinHours: true, behavior, message };
  }
  const within = timeInWindow(hhmm, entry.open, entry.close);
  return { withinHours: within, behavior, message };
}

function normalizeBehavior(value: unknown): OutsideHoursBehavior {
  if (
    value === OutsideHoursBehavior.BLACK_SCREEN ||
    value === OutsideHoursBehavior.CUSTOM_MESSAGE ||
    value === OutsideHoursBehavior.SLEEP ||
    value === OutsideHoursBehavior.FALLBACK
  ) {
    return value;
  }
  return OutsideHoursBehavior.FALLBACK;
}
