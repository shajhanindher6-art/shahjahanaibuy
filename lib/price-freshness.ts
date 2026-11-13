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
 * (Section 19, Phase 2 §12 #21: "not stale" is NOT "fresh" — an
 * unknown age must never be read as a fresh price. Callers that
 * render a freshness state must use getFreshnessStatus below, which
 * distinguishes the three states; isPriceStale stays a pure
 * stale/not-stale predicate so SEO/catalog callers that treat
 * "unknown" as "no stale offer" keep their existing behaviour.)
 */
export function isPriceStale(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): boolean {
  const age = getPriceAgeDays(value, now);
  return age !== null && age > STALE_PRICE_DAYS;
}

/**
 * Three-state freshness (Section 19, Phase 2 §12 #21) — the
 * fail-open fix. `isPriceStale` returns false for an unknown age,
 * which callers used to read as "fresh". This helper never does:
 * - 'fresh' — a parseable check within STALE_PRICE_DAYS.
 * - 'stale' — a parseable check older than STALE_PRICE_DAYS.
 * - 'unknown' — no recorded check at all (missing/empty/unparseable).
 * Render 'unknown' as "age unknown" text, never as nothing.
 */
export type FreshnessStatus = 'fresh' | 'stale' | 'unknown';

export function getFreshnessStatus(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): { status: FreshnessStatus; ageDays: number | null } {
  const age = getPriceAgeDays(value, now);
  if (age === null) return { status: 'unknown', ageDays: null };
  return { status: age > STALE_PRICE_DAYS ? 'stale' : 'fresh', ageDays: age };
}

/**
 * Section 20, §12 #81 — the freshness gate for "is now" alert
 * triggers. Returns 'stale' when the triggering record is older
 * than STALE_PRICE_DAYS, 'unknown' when no check date exists, and
 * 'fresh' otherwise. Callers SUPPRESS stale triggers and QUALIFY
 * unknown-age ones (the price may be out of date) — never present
 * either as a current price.
 *
 * Sections 21–25 (gate fix) — these two pure helpers used to live
 * in services/alert-checker.ts, which the refresh-chain route
 * tests mock with `{ checkPriceAlerts }` only. The guest-alert
 * path (services/guest-alerts.ts) calls them, so the mock made
 * them undefined and every guest alert failed with a vitest
 * "No export defined" throw. They live here now, next to
 * getFreshnessStatus, and alert-checker re-exports them so
 * existing importers keep working.
 */
export function alertPriceFreshness(
  recordedAt: string | null | undefined,
  now: Date = new Date()
): 'fresh' | 'stale' | 'unknown' {
  return getFreshnessStatus(recordedAt, now).status;
}

/** Staleness note appended to a trigger body whose price age is unknown. */
export function alertUnknownAgeNote(): string {
  return ' Price age unknown — this price was not recorded with a check date, so it may be out of date.';
}

/**
 * Freshness gate for INTERPRETIVE verdicts (Section 19, Phase 2
 * §12 #20). A "good time to buy" / "near its lowest" verdict that
 * reasons about a stale price must be suppressed or qualified —
 * a visitor otherwise sees "Stale price · 10 days old" in one
 * place and "good time to buy" in another, unreconciled.
 * Returns null when the price is fresh (no qualification needed),
 * otherwise the honest qualifier to render alongside the verdict
 * (or to substitute for it — see services/ai-summary.ts, which
 * rewrites the verdict sentence itself for fresh generations and
 * attaches this note to cached rows whose stored text predates
 * the staleness).
 */
export function formatVerdictFreshnessNote(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): string | null {
  const { status, ageDays } = getFreshnessStatus(value, now);
  if (status === 'fresh') return null;
  if (status === 'stale') {
    const age = ageDays ?? 0;
    return (
      `Based on a price last checked ${age} day${age === 1 ? '' : 's'} ago ` +
      `— it may be out of date.`
    );
  }
  return (
    'Price age unknown — this verdict is based on a price whose ' +
    'last check date is not recorded, so it may be out of date.'
  );
}
