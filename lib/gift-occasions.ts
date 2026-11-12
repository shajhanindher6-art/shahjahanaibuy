/**
 * Gift Occasion Planner — pure helpers for /tools/gift-occasions
 * (Section 16, E9 / item 27).
 *
 * Upcoming occasions with dates + budgets → a dated plan with
 * lead time and one priced catalog pick per occasion.
 *
 * Honesty rules:
 * - Occasion is display-only: the catalog has no occasion
 *   tagging, so a pick is chosen by BUDGET only (cheapest priced
 *   pick that fits — the page uses findGiftPicks with no
 *   interests). No occasion → product mapping is ever invented.
 * - In-page display only: this page shows a plan. It does NOT
 *   send reminders — actual reminder delivery would need push /
 *   email keys (owner-gated) — so no copy anywhere promises a
 *   notification, an email, or a reminder.
 * - Lead time is a planning suggestion, not a delivery promise:
 *   "plan to order at least 7 days before" is labelled as a
 *   planning buffer; shipping times are not recorded anywhere.
 * - Past occasions are shown as passed, with no pick.
 */

export interface GiftOccasionInput {
  name: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  budgetUsd: number;
}

export type GiftOccasionStatus = 'upcoming' | 'today' | 'passed';

export interface GiftOccasionPlan {
  name: string;
  date: string;
  budgetUsd: number;
  status: GiftOccasionStatus;
  /** Whole days from now until the occasion (0 = today, negative = passed). */
  daysUntil: number;
  /** Suggested order-by date (7 days before), or null when already passed. */
  orderByDate: string | null;
}

export const GIFT_OCCASIONS_MAX_ROWS = 5;
/** Planning buffer before the occasion — a suggestion, not a delivery promise. */
export const GIFT_OCCASION_LEAD_DAYS = 7;

function toDayStart(value: Date): Date {
  // UTC day start, not local: an ISO occasion date is a calendar
  // date, and mixing a local-midnight parse with a UTC output
  // (toISOString) shifted dates by a day in UTC+ timezones.
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Plan one occasion against `now` (day granularity). */
export function planGiftOccasion(
  occasion: GiftOccasionInput,
  now: Date = new Date()
): GiftOccasionPlan | null {
  const name = occasion.name.trim();
  const date = new Date(`${occasion.date}T00:00:00Z`);
  if (name.length === 0) return null;
  if (!Number.isFinite(date.getTime())) return null;
  if (!Number.isFinite(occasion.budgetUsd) || occasion.budgetUsd <= 0) return null;

  const daysUntil = Math.round(
    (toDayStart(date).getTime() - toDayStart(now).getTime()) / (24 * 60 * 60 * 1000)
  );
  const status: GiftOccasionStatus =
    daysUntil > 0 ? 'upcoming' : daysUntil === 0 ? 'today' : 'passed';
  return {
    name,
    date: occasion.date,
    budgetUsd: Math.round(occasion.budgetUsd * 100) / 100,
    status,
    daysUntil,
    orderByDate:
      status === 'passed' ? null : addDays(occasion.date, -GIFT_OCCASION_LEAD_DAYS),
  };
}

/** Plan a list of occasions, soonest first; invalid rows are dropped. */
export function planGiftOccasions(
  occasions: GiftOccasionInput[],
  now: Date = new Date()
): GiftOccasionPlan[] {
  return occasions
    .map((o) => planGiftOccasion(o, now))
    .filter((p): p is GiftOccasionPlan => p !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Parse the page's GET params: repeated ?name=…&date=…&budget=…
 * rows, aligned by index (up to 5 rows; blank rows ignored).
 */
export function parseGiftOccasionParams(searchParams: {
  name?: string | string[];
  date?: string | string[];
  budget?: string | string[];
}): { occasions: GiftOccasionInput[]; errors: string[]; hasQuery: boolean } {
  const list = (v: string | string[] | undefined): string[] =>
    v === undefined ? [] : Array.isArray(v) ? v : [v];
  const names = list(searchParams.name);
  const dates = list(searchParams.date);
  const budgets = list(searchParams.budget);
  const hasQuery = names.length > 0 || dates.length > 0 || budgets.length > 0;
  const errors: string[] = [];
  const occasions: GiftOccasionInput[] = [];

  const rows = Math.min(
    Math.max(names.length, dates.length, budgets.length),
    GIFT_OCCASIONS_MAX_ROWS
  );
  for (let i = 0; i < rows; i++) {
    const name = (names[i] ?? '').trim();
    const date = (dates[i] ?? '').trim();
    const budgetRaw = (budgets[i] ?? '').trim();
    if (name.length === 0 && date.length === 0 && budgetRaw.length === 0) continue;
    if (name.length === 0) {
      errors.push(`Occasion row ${i + 1} needs a name.`);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) {
      errors.push(`"${name}" needs a valid date (YYYY-MM-DD).`);
      continue;
    }
    const budget = Number(budgetRaw.replace(/,/g, ''));
    if (!Number.isFinite(budget) || budget <= 0) {
      errors.push(`"${name}" needs a budget above $0.`);
      continue;
    }
    occasions.push({ name, date, budgetUsd: budget });
  }
  if (Math.max(names.length, dates.length, budgets.length) > GIFT_OCCASIONS_MAX_ROWS) {
    errors.push(`At most ${GIFT_OCCASIONS_MAX_ROWS} occasions per plan.`);
  }
  return { occasions, errors, hasQuery };
}
