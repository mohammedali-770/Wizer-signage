/**
 * Locale-aware formatting helpers with a deliberate constraint:
 * digits are ALWAYS rendered in the Latin (English) numbering system.
 *
 * Why force `numberingSystem: 'latn'`?
 * ----------------------------------------------------------------------------
 * Arabic locales (e.g. `ar`, `ar-EG`) default to Eastern Arabic numerals
 * (٠١٢٣٤٥٦٧٨٩). For Wizer Signage the product requirement is that all numeric
 * output — counts, metrics, dates, IDs — uses Western/Latin digits (0-9)
 * even when the surrounding UI is Arabic and laid out right-to-left.
 * Pinning `numberingSystem: 'latn'` guarantees consistent, scannable numbers
 * regardless of the active locale, while still honouring locale-specific
 * grouping and date field ordering.
 */

const LATIN_NUMBERING_SYSTEM = 'latn' as const;

/**
 * Format a number for the given locale using Latin digits.
 *
 * @param value  The numeric value to format.
 * @param locale BCP-47 locale tag (defaults to `en`).
 * @param options Standard `Intl.NumberFormat` options (numberingSystem is forced).
 */
export function formatNumber(
  value: number,
  locale: string = 'en',
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(locale, {
    ...options,
    numberingSystem: LATIN_NUMBERING_SYSTEM,
  }).format(value);
}

/**
 * Format a date for the given locale using Latin digits.
 *
 * @param value  Date instance, timestamp, or ISO string.
 * @param locale BCP-47 locale tag (defaults to `en`).
 * @param options Standard `Intl.DateTimeFormat` options (numberingSystem is forced).
 */
export function formatDate(
  value: Date | number | string,
  locale: string = 'en',
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  const date = value instanceof Date ? value : new Date(value);

  return new Intl.DateTimeFormat(locale, {
    ...options,
    numberingSystem: LATIN_NUMBERING_SYSTEM,
  }).format(date);
}

/** Date + time (medium date, short time) with Latin digits. */
export function formatDateTime(value: Date | number | string, locale = 'en'): string {
  return formatDate(value, locale, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Currency amount (accepts number or numeric string) with Latin digits. */
export function formatCurrency(value: number | string, currency = 'USD', locale = 'en'): string {
  const amount = typeof value === 'string' ? Number(value) : value;
  return formatNumber(Number.isFinite(amount) ? amount : 0, locale, {
    style: 'currency',
    currency,
  });
}

/** Human-readable duration from seconds (e.g. "1m 30s", "2h 5m") with Latin digits. */
export function formatDuration(totalSeconds: number, locale = 'en'): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (h) parts.push(`${formatNumber(h, locale)}h`);
  if (m) parts.push(`${formatNumber(m, locale)}m`);
  if (s || parts.length === 0) parts.push(`${formatNumber(s, locale)}s`);
  return parts.join(' ');
}

/** Human-readable byte size (e.g. "1.5 GB") with Latin digits. */
export function formatBytes(value: number | string, locale = 'en'): string {
  // Accepts a string because byte counts come off 64-bit columns and are
  // serialised as strings — the same reason formatCurrency does.
  const bytes = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(bytes) || bytes < 1) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1000)), units.length - 1);
  const scaled = bytes / 1000 ** exponent;
  return `${formatNumber(scaled, locale, { maximumFractionDigits: 1 })} ${units[exponent]}`;
}
