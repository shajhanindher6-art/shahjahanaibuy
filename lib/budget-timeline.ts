/**
 * Timeline / "need by" input for budget tools (Section 19, Phase 4,
 * §12 #37).
 *
 * No budget tool collected a deadline before this: a shopper who
 * needs a laptop by Friday got the same "wait for a price drop"
 * advice as a shopper with no deadline at all. These pure helpers
 * make the deadline a real input that changes the output:
 *
 * - The date is parsed strictly (YYYY-MM-DD only; anything else is
 *   null, never guessed).
 * - A past date is invalid, never silently treated as "no deadline".
 * - When the deadline is near, "wait" is NOT offered: with only 4
 *   recorded price points per product, no price drop can be
 *   predicted before a near deadline, and the tools must say so
 *   instead of promising one.
 * - When the deadline is far, waiting stays possible in principle —
 *   but still only as a labelled estimate, never a promised drop.
 *
 * The "near" threshold is 14 days: inside it, a drop prediction
 * would need price history the catalog does not have (4 points over
 * 30 days), so the honest answer is "buy on price now, or wait only
 * if you can slip the date".
 */

export interface NeedByValidation {
  /** The parsed date (UTC midnight), or null when invalid/missing. */
  date: Date | null;
  /** Human-readable problem, or null when the input is usable. */
  error: string | null;
}

const NEED_BY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Strict YYYY-MM-DD parse. Returns { date: null, error } for an
 * empty string (treated as "no deadline", error null), a malformed
 * date, an impossible calendar date (2026-02-30), or a past date.
 * `today` is injectable so tests never depend on the real clock.
 */
export function parseNeedByDate(
  raw: string | null | undefined,
  today: Date = new Date()
): NeedByValidation {
  if (raw === null || raw === undefined || raw.trim() === '') {
    return { date: null, error: null };
  }
  const value = raw.trim();
  if (!NEED_BY_PATTERN.test(value)) {
    return { date: null, error: `"${value}" is not a valid date — use YYYY-MM-DD, e.g. 2026-12-01.` };
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return { date: null, error: `"${value}" is not a real calendar date.` };
  }
  // Reject impossible dates the Date constructor silently rolls
  // over (2026-02-30 becomes 2026-03-02).
  if (date.toISOString().slice(0, 10) !== value) {
    return { date: null, error: `"${value}" is not a real calendar date.` };
  }
  const todayStart = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  );
  if (date.getTime() < todayStart.getTime()) {
    return { date: null, error: `"${value}" is in the past — pick a future date, or leave it blank.` };
  }
  return { date, error: null };
}

/** What the deadline means for the buy/wait advice. */
export interface TimelineAdvice {
  /** Whole days from today until the deadline. */
  daysUntil: number;
  /** True when the deadline is close enough that waiting is not offered. */
  deadlineNear: boolean;
  /** True when waiting is even an option to discuss. */
  waitOffered: boolean;
  /** Honest one-liner the tools render next to the picks. */
  note: string;
}

/** Days inside which a deadline counts as "near" (see header). */
export const NEED_BY_NEAR_DAYS = 14;

export function timelineAdvice(
  needBy: Date | null,
  today: Date = new Date()
): TimelineAdvice | null {
  if (!needBy) return null;
  const todayStart = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  );
  const daysUntil = Math.round(
    (needBy.getTime() - todayStart.getTime()) / (24 * 60 * 60 * 1000)
  );
  const deadlineNear = daysUntil <= NEED_BY_NEAR_DAYS;
  if (deadlineNear) {
    return {
      daysUntil,
      deadlineNear: true,
      waitOffered: false,
      note:
        daysUntil === 0
          ? 'You need this today — waiting for a price drop is not an option, and with only 4 recorded price points no drop can be predicted anyway. Judge the picks on today\u2019s recorded price.'
          : `You need this in ${daysUntil} day${daysUntil === 1 ? '' : 's'} — too soon to wait for a price drop. With only 4 recorded price points no drop can be predicted before your deadline, so judge the picks on today\u2019s recorded price.`,
    };
  }
  return {
    daysUntil,
    deadlineNear: false,
    waitOffered: true,
    note: `You need this in ${daysUntil} days. Waiting is possible in principle, but no price drop is predicted — the catalog has only 4 recorded price points per product, so any "wait" advice would be a guess, not a forecast.`,
  };
}
