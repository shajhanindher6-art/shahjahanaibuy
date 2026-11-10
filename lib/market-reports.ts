/**
 * Market reports — weekly deal reports, monthly category deep-dives,
 * and seasonal buying guides, generated ONLY from recorded price
 * data. No invented figures, no scraped prices, no seasonal claims
 * the history cannot support.
 *
 * Every report carries its depth (products / points / history days)
 * and a data-quality label, and says so when the data is thin:
 * - 'sufficient': ≥ 90 days of history and ≥ 20 recorded points.
 * - 'thin': at least 5 recorded points but below the sufficient bar.
 * - 'insufficient': fewer than 5 points — the report states what
 *   is missing instead of drawing conclusions.
 *
 * A "best time to buy" claim is made ONLY when historyDays ≥ 90;
 * otherwise the guide says plainly that there is not enough
 * history to say when prices are lowest. Seed/demo prices are
 * never presented as live retailer prices — any figure that comes
 * from the recorded history is labelled as recorded, and the
 * report methodology line says so.
 *
 * These builders are pure: callers pass in numbers already computed
 * from the database (price drops, index entries, category changes)
 * and get report copy back. Nothing here reads the database, so a
 * report can never silently invent a figure its inputs lack.
 */

export type ReportKind =
  | 'weekly-deal-report'
  | 'monthly-deep-dive'
  | 'seasonal-guide';

export type ReportDataQuality = 'sufficient' | 'thin' | 'insufficient';

/**
 * Editorial guidelines (Section 4 item 17) that every generated
 * report must follow. Rendered on the reports page alongside the
 * reports themselves, so readers can hold the reports to them.
 */
export const EDITORIAL_GUIDELINES: string[] = [
  'Every figure comes from recorded price history — never from seed/demo prices presented as live, never scraped, never invented.',
  'Where data is thin, the report says so instead of drawing a conclusion.',
  'A “best time to buy” claim needs at least 90 days of recorded history; otherwise the report says there is not enough history yet.',
  'Estimates and simulations are labelled as estimates and simulations, never as measured facts.',
  'A price drop is a recorded drop between two real recorded prices — never a discount off an invented compare-at price.',
];

export interface ReportDepth {
  products: number;
  points: number;
  historyDays: number;
}

export interface MarketReport {
  kind: ReportKind;
  slug: string;
  title: string;
  periodLabel: string;
  category: string | null;
  /** Region code, or 'GLOBAL' for all regions pooled. */
  region: string;
  summary: string;
  findings: string[];
  dataQuality: ReportDataQuality;
  depth: ReportDepth;
  /** Fixed methodology line, shown on every report. */
  methodology: string;
}

const REPORT_METHODOLOGY =
  'Computed from recorded price history only. Seed prices are demo prices, not live retailer prices.';

export function dataQualityFor(depth: ReportDepth): ReportDataQuality {
  if (depth.points < 5) return 'insufficient';
  if (depth.historyDays >= 90 && depth.points >= 20) return 'sufficient';
  return 'thin';
}

export function dataQualityLabel(quality: ReportDataQuality): string {
  if (quality === 'sufficient') return 'Good data depth';
  if (quality === 'thin') return 'Thin data — read with care';
  return 'Not enough data yet';
}

export function reportSlug(kind: ReportKind, periodLabel: string): string {
  const period = periodLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${kind}-${period}`;
}

export interface RecordedDrop {
  productName: string;
  category: string | null;
  dropPct: number;
  oldPrice: number;
  newPrice: number;
  date: string;
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * Weekly deal report: the biggest RECORDED price drops of the week.
 * `drops` must already be real point-to-point drops (e.g. from
 * computePriceDrops) — this builder ranks and narrates them, it
 * never synthesises a drop. An empty drop list is an honest empty
 * report, not a zero-filled one.
 */
export function buildWeeklyDealReport(input: {
  drops: RecordedDrop[];
  weekLabel: string;
  region?: string;
  depth: ReportDepth;
}): MarketReport {
  const region = input.region ?? 'GLOBAL';
  const quality = dataQualityFor(input.depth);
  const ranked = [...input.drops]
    .filter((d) => Number.isFinite(d.dropPct) && d.dropPct > 0)
    .sort((a, b) => b.dropPct - a.dropPct)
    .slice(0, 5);
  const findings: string[] = [];
  if (ranked.length === 0) {
    findings.push(
      'No price drops were recorded this week. That means no tracked product had a lower recorded price than its previous recorded price — not that prices stayed still everywhere, only that nothing in the recorded history dropped.'
    );
  } else {
    for (const d of ranked) {
      findings.push(
        `${d.productName} dropped ${d.dropPct.toFixed(1)}% — from ${money(d.oldPrice)} to ${money(d.newPrice)} (recorded ${d.date.slice(0, 10)}).`
      );
    }
    const median =
      ranked.length % 2 === 1
        ? ranked[Math.floor(ranked.length / 2)].dropPct
        : (ranked[ranked.length / 2 - 1].dropPct + ranked[ranked.length / 2].dropPct) / 2;
    findings.push(
      `Median drop among the ${ranked.length} largest recorded drops this week: ${median.toFixed(1)}%.`
    );
  }
  if (quality !== 'sufficient') {
    findings.push(
      `Data depth is ${quality === 'insufficient' ? 'insufficient' : 'thin'} (${input.depth.points} recorded prices over ${input.depth.historyDays} days) — this report covers only what was recorded, and more history will make it more useful.`
    );
  }
  return {
    kind: 'weekly-deal-report',
    slug: reportSlug('weekly-deal-report', input.weekLabel),
    title: `Weekly deal report — ${input.weekLabel}`,
    periodLabel: input.weekLabel,
    category: null,
    region,
    summary:
      ranked.length === 0
        ? 'No price drops were recorded this week.'
        : `${ranked.length} recorded price drop${ranked.length === 1 ? '' : 's'} this week, largest ${ranked[0].dropPct.toFixed(1)}% on ${ranked[0].productName}.`,
    findings,
    dataQuality: quality,
    depth: input.depth,
    methodology: REPORT_METHODOLOGY,
  };
}

/**
 * Monthly category deep-dive: one category's index movement for one
 * month, narrated from the index value and the month-over-month
 * change only. A null indexValue (insufficient data) produces an
 * honest "not enough data" report, never a made-up trend.
 */
export function buildCategoryDeepDive(input: {
  category: string;
  periodMonth: string;
  indexValue: number | null;
  baseMonth: string | null;
  changePct: number | null;
  direction: 'up' | 'down' | 'flat' | 'unknown';
  region?: string;
  depth: ReportDepth;
}): MarketReport {
  const region = input.region ?? 'GLOBAL';
  const quality = dataQualityFor(input.depth);
  const findings: string[] = [];
  if (input.indexValue === null || input.baseMonth === null) {
    findings.push(
      `${input.category} does not have enough recorded prices yet for a monthly index — at least 2 products need recorded prices in both the base month and ${input.periodMonth}.`
    );
  } else {
    findings.push(
      `The ${input.category} index for ${input.periodMonth} is ${input.indexValue.toFixed(1)} (base ${input.baseMonth} = 100), ${input.depth.products} product${input.depth.products === 1 ? '' : 's'} with recorded prices.`
    );
    if (input.changePct === null) {
      findings.push(
        'No previous published month exists yet, so there is no month-over-month change to report.'
      );
    } else if (input.direction === 'flat') {
      findings.push(
        `Month over month, the index moved ${input.changePct.toFixed(1)}% — effectively flat.`
      );
    } else {
      findings.push(
        `Month over month, the index moved ${input.changePct > 0 ? '+' : ''}${input.changePct.toFixed(1)}% (${input.direction === 'down' ? 'prices fell' : 'prices rose'} on average across the tracked products).`
      );
    }
  }
  if (quality !== 'sufficient') {
    findings.push(
      `Data depth is ${quality === 'insufficient' ? 'insufficient' : 'thin'} (${input.depth.points} recorded prices over ${input.depth.historyDays} days) — treat this deep-dive as a first sketch, not a settled trend.`
    );
  }
  return {
    kind: 'monthly-deep-dive',
    slug: reportSlug('monthly-deep-dive', `${input.category}-${input.periodMonth}`),
    title: `${input.category}: monthly deep-dive — ${input.periodMonth}`,
    periodLabel: input.periodMonth,
    category: input.category,
    region,
    summary:
      input.indexValue === null
        ? `${input.category} does not have enough recorded prices yet for a monthly index.`
        : `${input.category} index ${input.indexValue.toFixed(1)} for ${input.periodMonth} (base ${input.baseMonth} = 100).`,
    findings,
    dataQuality: quality,
    depth: input.depth,
    methodology: REPORT_METHODOLOGY,
  };
}

export interface CategoryLow {
  category: string;
  /** Lowest RECORDED price for the category in the covered history. */
  lowest: number;
  /** Most recent RECORDED price (mean across the category's products). */
  current: number;
  productsUsed: number;
}

/**
 * Seasonal buying guide: which categories are near their recorded
 * lows, and — only with ≥ 90 days of history — when prices have
 * tended to be lowest. With less history the guide says plainly
 * that the best time to buy cannot be established yet.
 */
export function buildSeasonalGuide(input: {
  seasonLabel: string;
  categoryLows: CategoryLow[];
  region?: string;
  depth: ReportDepth;
}): MarketReport {
  const region = input.region ?? 'GLOBAL';
  const quality = dataQualityFor(input.depth);
  const findings: string[] = [];
  if (input.categoryLows.length === 0) {
    findings.push(
      'No category has enough recorded prices yet to say anything about seasonal lows.'
    );
  } else {
    for (const c of input.categoryLows) {
      const vsLow =
        c.lowest > 0 ? ((c.current - c.lowest) / c.lowest) * 100 : null;
      findings.push(
        vsLow === null
          ? `${c.category}: recorded low ${money(c.lowest)} across ${c.productsUsed} product${c.productsUsed === 1 ? '' : 's'}.`
          : `${c.category}: currently ${vsLow.toFixed(1)}% above its recorded low (${money(c.lowest)} → ${money(c.current)} now).`
      );
    }
  }
  if (input.depth.historyDays >= 90) {
    findings.push(
      `With ${input.depth.historyDays} days of recorded history, seasonal patterns can start to be read — but a pattern is still only a tendency in recorded prices, not a promise about the next season.`
    );
  } else {
    findings.push(
      `Only ${input.depth.historyDays} days of price history are recorded, so this guide cannot say when prices are lowest in the season — that needs at least 90 days of history.`
    );
  }
  if (quality !== 'sufficient') {
    findings.push(
      `Data depth is ${quality === 'insufficient' ? 'insufficient' : 'thin'} (${input.depth.points} recorded prices) — treat this guide as a starting point, not a verdict.`
    );
  }
  return {
    kind: 'seasonal-guide',
    slug: reportSlug('seasonal-guide', input.seasonLabel),
    title: `Seasonal buying guide — ${input.seasonLabel}`,
    periodLabel: input.seasonLabel,
    category: null,
    region,
    summary:
      input.categoryLows.length === 0
        ? 'Not enough recorded prices yet for a seasonal guide.'
        : `${input.categoryLows.length} categor${input.categoryLows.length === 1 ? 'y' : 'ies'} compared against their recorded lows for ${input.seasonLabel}.`,
    findings,
    dataQuality: quality,
    depth: input.depth,
    methodology: REPORT_METHODOLOGY,
  };
}
