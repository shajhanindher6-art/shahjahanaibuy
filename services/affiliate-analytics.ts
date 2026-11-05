/**
 * Geo-click analytics — Step C (Phase 4 Workstream C).
 *
 * PURE aggregation over `affiliate_geo_clicks` rows: no Supabase, no
 * env, no IO, so it can be unit-tested directly. The DB fetch lives
 * in services/admin.ts (getAffiliateClickAnalytics) and the HTTP
 * surface in app/api/v1/admin/affiliate-clicks/route.ts.
 *
 * PRIVACY: the input rows carry no IP, user agent, or user id — only
 * product, retailer, merchant URL, country, and timestamp — so
 * nothing here can leak a person. Burst flagging is aggregate-only:
 * a bucket is (hour, country, retailer, product), never a person.
 *
 * BURST RULE (Stage 1): any (hour, country, retailer, product)
 * bucket with more than AFFILIATE_BURST_THRESHOLD clicks is flagged.
 * Flagged clicks are EXCLUDED from headline totals and breakdowns
 * and shown separately, so a spam burst cannot inflate the numbers
 * an admin acts on. No rows are deleted and no bucket is hidden —
 * the exclusion is stated on the admin page.
 */

export interface AffiliateClickRow {
  product_slug: string | null;
  retailer_name: string | null;
  target_url: string;
  country_code: string | null;
  clicked_at: string;
}

export interface AffiliateClickBucket {
  label: string;
  clicks: number;
}

export interface AffiliateClickFlag {
  hour: string;
  countryCode: string | null;
  retailerName: string | null;
  productSlug: string | null;
  clicks: number;
}

export interface AffiliateClickRecent {
  productSlug: string | null;
  retailerName: string | null;
  targetUrl: string;
  countryCode: string | null;
  clickedAt: string;
}

export interface AffiliateClickAnalytics {
  days: number;
  totalClicks: number;
  flaggedClicks: number;
  clicksToday: number;
  topCountry: string | null;
  topRetailer: string | null;
  topProduct: string | null;
  byCountry: AffiliateClickBucket[];
  byRetailer: AffiliateClickBucket[];
  byProduct: AffiliateClickBucket[];
  byDay: Array<{ date: string; clicks: number }>;
  recent: AffiliateClickRecent[];
  flags: AffiliateClickFlag[];
}

/** Starting burst threshold (clicks/hour per bucket) — a config value
 *  to tune once real traffic exists, not a measured constant. */
export const AFFILIATE_BURST_THRESHOLD = 100;

const TOP_N = 10;
const RECENT_N = 20;

function topBuckets(counts: Map<string, number>): AffiliateClickBucket[] {
  return Array.from(counts.entries())
    .map(([label, clicks]) => ({ label, clicks }))
    .sort((a, b) => b.clicks - a.clicks || a.label.localeCompare(b.label))
    .slice(0, TOP_N);
}

function emptyAnalytics(days: number): AffiliateClickAnalytics {
  return {
    days,
    totalClicks: 0,
    flaggedClicks: 0,
    clicksToday: 0,
    topCountry: null,
    topRetailer: null,
    topProduct: null,
    byCountry: [],
    byRetailer: [],
    byProduct: [],
    byDay: [],
    recent: [],
    flags: [],
  };
}

export function analyzeAffiliateClicks(
  rows: AffiliateClickRow[],
  days: number,
  now: Date = new Date()
): AffiliateClickAnalytics {
  const result = emptyAnalytics(days);
  if (rows.length === 0) {
    // Still fill the day series so the chart renders an honest flat line.
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      result.byDay.push({ date: d.toISOString().slice(0, 10), clicks: 0 });
    }
    return result;
  }

  // 1. Bucket by (UTC hour, country, retailer, product) and flag bursts.
  const bucketCounts = new Map<string, number>();
  for (const row of rows) {
    const hour = row.clicked_at.slice(0, 13); // "2026-11-05T11"
    const key = [hour, row.country_code ?? '', row.retailer_name ?? '', row.product_slug ?? ''].join('|');
    bucketCounts.set(key, (bucketCounts.get(key) ?? 0) + 1);
  }
  const flaggedKeys = new Set<string>();
  for (const [key, count] of bucketCounts) {
    if (count > AFFILIATE_BURST_THRESHOLD) {
      flaggedKeys.add(key);
      const [hour, countryCode, retailerName, productSlug] = key.split('|');
      result.flags.push({
        hour,
        countryCode: countryCode || null,
        retailerName: retailerName || null,
        productSlug: productSlug || null,
        clicks: count,
      });
    }
  }
  result.flags.sort((a, b) => b.clicks - a.clicks);

  const isFlagged = (row: AffiliateClickRow): boolean => {
    const hour = row.clicked_at.slice(0, 13);
    const key = [hour, row.country_code ?? '', row.retailer_name ?? '', row.product_slug ?? ''].join('|');
    return flaggedKeys.has(key);
  };

  // 2. Aggregate the unflagged rows only.
  const byCountry = new Map<string, number>();
  const byRetailer = new Map<string, number>();
  const byProduct = new Map<string, number>();
  const byDay = new Map<string, number>();
  const today = now.toISOString().slice(0, 10);
  let clicksToday = 0;

  for (const row of rows) {
    if (isFlagged(row)) {
      result.flaggedClicks += 1;
      continue;
    }
    result.totalClicks += 1;
    const day = row.clicked_at.slice(0, 10);
    if (day === today) clicksToday += 1;
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
    const country = row.country_code ?? 'Unknown';
    byCountry.set(country, (byCountry.get(country) ?? 0) + 1);
    const retailer = row.retailer_name ?? 'Unknown retailer';
    byRetailer.set(retailer, (byRetailer.get(retailer) ?? 0) + 1);
    const product = row.product_slug ?? 'Unknown product';
    byProduct.set(product, (byProduct.get(product) ?? 0) + 1);
  }
  result.clicksToday = clicksToday;
  result.byCountry = topBuckets(byCountry);
  result.byRetailer = topBuckets(byRetailer);
  result.byProduct = topBuckets(byProduct);
  result.topCountry = result.byCountry[0]?.label ?? null;
  result.topRetailer = result.byRetailer[0]?.label ?? null;
  result.topProduct = result.byProduct[0]?.label ?? null;

  // Fill every day in the window so the chart never implies a gap.
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const date = d.toISOString().slice(0, 10);
    result.byDay.push({ date, clicks: byDay.get(date) ?? 0 });
  }

  // Recent clicks: the newest rows regardless of flag state — flags
  // are listed separately, and nothing is hidden.
  result.recent = [...rows]
    .sort((a, b) => b.clicked_at.localeCompare(a.clicked_at))
    .slice(0, RECENT_N)
    .map((row) => ({
      productSlug: row.product_slug,
      retailerName: row.retailer_name,
      targetUrl: row.target_url,
      countryCode: row.country_code,
      clickedAt: row.clicked_at,
    }));

  return result;
}
