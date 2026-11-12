/**
 * Pure "prices last checked" helpers — derived ONLY from recorded
 * `price_history` points. No network, no clock, no invented dates:
 * when there are no valid points there is no timestamp at all, and
 * the caller renders nothing.
 */

export interface FreshnessPoint {
  recordedAt?: string | null;
}

/**
 * Latest valid `recorded_at` across the points (ISO string as stored),
 * or null when the list is empty, missing, or holds no parseable date.
 * Unsorted input is fine; null entries and invalid dates are skipped.
 */
export function latestRecordedAt(
  points: ReadonlyArray<FreshnessPoint | null | undefined> | null | undefined,
): string | null {
  if (!points) return null;
  let latestMs: number | null = null;
  let latestIso: string | null = null;
  for (const point of points) {
    const iso = point?.recordedAt;
    if (typeof iso !== 'string' || iso === '') continue;
    const ms = new Date(iso).getTime();
    if (!Number.isFinite(ms)) continue;
    if (latestMs === null || ms > latestMs) {
      latestMs = ms;
      latestIso = iso;
    }
  }
  return latestIso;
}

/**
 * Human date for a `recorded_at` value ("Nov 8, 2026"), or null when
 * the input is missing, empty, or not a parseable date. A null return
 * means "show nothing", never a placeholder.
 */
export function formatLastChecked(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Stale-price threshold (Section 15 P1-11). Prices whose last
 * check is older than this many whole days get the stale badge on
 * the product page. 7 days matches the weekly refresh cadence the
 * site claims ("Every 6 hours" is the schedule; a week without a
 * successful check is plainly stale either way).
 */
export const STALE_PRICE_DAYS = 7;

/**
 * Whole days between a last-checked value and `now` (default: now),
 * or null when the value is missing, empty, or not a parseable date.
 * A null return means "age unknown" — the caller renders nothing,
 * never a guessed age. Future dates age 0 or negative, never stale.
 */
export function getPriceAgeDays(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return null;
  return Math.floor((nowMs - date.getTime()) / 86_400_000);
}

/**
 * True when a last-checked value is older than STALE_PRICE_DAYS.
 * Missing, empty, or unparseable values are NOT stale — there is
 * nothing to label, so the caller renders no badge at all.
 */
export function isPriceStale(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): boolean {
  const age = getPriceAgeDays(value, now);
  return age !== null && age > STALE_PRICE_DAYS;
}
