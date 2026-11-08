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
