/**
 * AI Best-Time-to-Buy Calendar (Section 7 item 7).
 *
 * Category-wise best-buy calendar derived ONLY from RECORDED
 * price_history points. No LLM, no key, no external call, no
 * invented sale dates.
 *
 * HONESTY RULES:
 * - A category needs at least 3 recorded points spanning at least
 *   2 distinct months — otherwise "not enough recorded history",
 *   never a guessed best month.
 * - Best months are the months whose recorded lowest price is
 *   within 5% of the category's lowest recorded monthly low.
 * - Output is RANGES only ("November", "October–December") — never
 *   an exact date promise, never "buy on 24 November".
 * - Seasonal labels (Black Friday, 11.11, year-end, mid-year) are
 *   generic MONTH markers, attached only to a month the recorded
 *   data actually shows as a best month. They are not sale dates
 *   and no sale is promised. Eid is deliberately NOT mapped to a
 *   fixed month: Eid shifts every year, so hardcoding a month
 *   would be invented data.
 */

export interface BestTimePoint {
  category: string;
  price: number;
  recordedAt: string;
}

export interface BestMonthStat {
  /** 0-based month: 0 = January, 10 = November. */
  month: number;
  monthName: string;
  lowestPrice: number;
  averagePrice: number;
  pointCount: number;
  /** Lowest price vs the category's average recorded price, %. */
  savingVsCategoryAvgPct: number;
  /** Generic month markers only (never a sale date). */
  seasonalLabels: string[];
}

export interface CategoryCalendar {
  category: string;
  status: 'ready' | 'insufficient';
  bestMonths: BestMonthStat[];
  /** Range label, e.g. "November" or "October–December", null when insufficient. */
  bestWindow: string | null;
  /** Distinct months with recorded points. */
  monthsCovered: number;
  pointCount: number;
  lowestPrice: number | null;
  reason: string;
}

/** Minimum recorded points per category before any best month is named. */
export const BEST_TIME_MIN_POINTS = 3;
/** Minimum distinct months with recorded points. */
export const BEST_TIME_MIN_MONTHS = 2;
/** A month counts as "best" when its low is within this % of the category low. */
export const BEST_TIME_WITHIN_PCT = 5;

export const MONTH_NAMES: readonly string[] = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Generic seasonal month markers. These describe the MONTH, not a
 * sale: they are attached only when recorded history shows that
 * month as a best month, and the UI must never present them as a
 * promised sale date.
 */
export const MONTH_SEASON_LABELS: Readonly<Record<number, readonly string[]>> = {
  6: ['Mid-year sale season'],
  7: ['Back-to-school season'],
  10: ['Black Friday season', '11.11 sale season'],
  11: ['Year-end sale season'],
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Range label for a set of best months, e.g. "November" or "October–December". */
export function bestWindowLabel(months: number[]): string | null {
  if (months.length === 0) return null;
  const sorted = [...months].sort((a, b) => a - b);
  if (sorted.length === 1) return MONTH_NAMES[sorted[0]];
  return `${MONTH_NAMES[sorted[0]]}–${MONTH_NAMES[sorted[sorted.length - 1]]}`;
}

/**
 * Build the per-category best-time calendar from recorded price
 * points. Pure — no DB, no network.
 */
export function buildBestTimeCalendar(points: BestTimePoint[]): CategoryCalendar[] {
  const byCategory = new Map<string, BestTimePoint[]>();
  for (const p of points) {
    if (!p.category || !Number.isFinite(p.price) || p.price <= 0) continue;
    const ms = new Date(p.recordedAt).getTime();
    if (!Number.isFinite(ms)) continue;
    const list = byCategory.get(p.category) ?? [];
    list.push(p);
    byCategory.set(p.category, list);
  }

  const calendars: CategoryCalendar[] = [];
  for (const [category, list] of [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const months = new Map<number, { prices: number[] }>();
    for (const p of list) {
      const month = new Date(p.recordedAt).getMonth();
      const entry = months.get(month) ?? { prices: [] };
      entry.prices.push(p.price);
      months.set(month, entry);
    }
    const monthsCovered = months.size;
    const allPrices = list.map((p) => p.price);
    const categoryAvg = allPrices.reduce((a, b) => a + b, 0) / allPrices.length;
    const lowestPrice = Math.min(...allPrices);

    if (list.length < BEST_TIME_MIN_POINTS || monthsCovered < BEST_TIME_MIN_MONTHS) {
      calendars.push({
        category,
        status: 'insufficient',
        bestMonths: [],
        bestWindow: null,
        monthsCovered,
        pointCount: list.length,
        lowestPrice,
        reason: `Not enough recorded price history for ${category} yet — ${list.length} recorded point${list.length === 1 ? '' : 's'} across ${monthsCovered} month${monthsCovered === 1 ? '' : 's'}. A best-buy window needs at least ${BEST_TIME_MIN_POINTS} points across ${BEST_TIME_MIN_MONTHS} months.`,
      });
      continue;
    }

    const monthStats: BestMonthStat[] = [...months.entries()].map(([month, entry]) => {
      const lowest = Math.min(...entry.prices);
      const avg = entry.prices.reduce((a, b) => a + b, 0) / entry.prices.length;
      return {
        month,
        monthName: MONTH_NAMES[month],
        lowestPrice: round2(lowest),
        averagePrice: round2(avg),
        pointCount: entry.prices.length,
        savingVsCategoryAvgPct: round2(((categoryAvg - lowest) / categoryAvg) * 100),
        seasonalLabels: [...(MONTH_SEASON_LABELS[month] ?? [])],
      };
    });

    const categoryLowestMonthly = Math.min(...monthStats.map((m) => m.lowestPrice));
    const threshold = categoryLowestMonthly * (1 + BEST_TIME_WITHIN_PCT / 100);
    const bestMonths = monthStats
      .filter((m) => m.lowestPrice <= threshold)
      .sort((a, b) => a.lowestPrice - b.lowestPrice);

    calendars.push({
      category,
      status: 'ready',
      bestMonths,
      bestWindow: bestWindowLabel(bestMonths.map((m) => m.month)),
      monthsCovered,
      pointCount: list.length,
      lowestPrice: round2(lowestPrice),
      reason: `From ${list.length} recorded price points across ${monthsCovered} months. Ranges only — this is not a promise of an exact date or a future price.`,
    });
  }

  return calendars;
}
