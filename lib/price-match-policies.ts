/**
 * Price-Match Finder — curated price-match policy summaries (T3).
 *
 * HONESTY RULES (do not weaken them — same pattern as
 * services/return-policies.ts):
 * - Every entry is a GENERAL policy summary written ONLY from the
 *   retailer's own public policy page, read at build time
 *   (manual reading, no scraping). Each entry records its source
 *   URL and a "last reviewed" stamp.
 * - Policies change: the page ALWAYS carries the disclaimer
 *   "General policy summary — always verify at the retailer's
 *   site before purchase".
 * - NOTHING is guessed. A store with no verified entry reads
 *   "Not recorded yet" — never a filled-in guess.
 * - Marketplace sellers read "Varies by seller" — no single
 *   policy exists for them.
 * - NEVER claim a price match will be granted, or any matched
 *   price. A match is always the retailer's decision, on the
 *   day, under its current terms.
 * - No deep links to guessed retailer help URLs: source URLs are
 *   only pages actually read at build time, or (for marketplaces)
 *   the retailer's homepage.
 */

/**
 * What the retailer's policy says, in one word:
 * - 'yes': matches competitor prices (with conditions).
 * - 'no': does not offer price matching.
 * - 'limited': matches only its OWN prices (own-site / own-store
 *   price drops or adjustments) — not competitors'.
 * - 'varies': marketplace — terms vary by seller.
 */
export type PriceMatchStatus = 'yes' | 'no' | 'limited' | 'varies';

/** Display label for each status (one wording, everywhere). */
export const PRICE_MATCH_STATUS_LABELS: Record<PriceMatchStatus, string> = {
  yes: 'Yes — matches competitor prices',
  no: 'No — does not price-match',
  limited: 'Limited — own prices only',
  varies: 'Varies by seller',
};

/** Stamp shown in the UI so staleness is visible, not hidden. */
export const PRICE_MATCH_LAST_REVIEWED = '2026-11-14';

/**
 * Disclaimer rendered with every policy summary, mirroring
 * services/return-policies.ts.
 */
export const PRICE_MATCH_DISCLAIMER =
  'General policy summary — always verify at the retailer\u2019s site before purchase.';

/** One curated policy entry. All strings are general summaries. */
export interface PriceMatchPolicy {
  /** Store display name, e.g. "Best Buy". */
  store: string;
  /** Store homepage domain (plain-text reference). */
  domain: string;
  /** What the policy says, in one word. */
  status: PriceMatchStatus;
  /** Short summary in our own words, from the source page. */
  summary: string;
  /** How to claim it, in our own words, from the source page. */
  howToClaim: string;
  /**
   * Retailer's own public policy page read at build time, or the
   * retailer's homepage when no single policy page exists
   * (marketplaces). Never a guessed URL.
   */
  sourceUrl: string;
  /** Date the source page was last read, ISO (YYYY-MM-DD). */
  lastReviewed: string;
}

/**
 * Curated policies verified at build time (2026-11-14) from each
 * retailer's own public policy page. Deliberately conservative:
 * where a policy covers only the retailer's own prices, the entry
 * says 'limited' instead of 'yes'.
 */
export const PRICE_MATCH_POLICIES: PriceMatchPolicy[] = [
  {
    store: 'Best Buy',
    domain: 'bestbuy.com',
    status: 'yes',
    summary:
      'Matches the current price of key online and local competitors ("Qualified Competitors") for an identical, immediately available new product. Also matches Best Buy\u2019s own lower price if it drops during the return and exchange period. Excludes marketplace products, clearance, refurbished and open-box items.',
    howToClaim:
      'At the time of sale in store, or via online chat or phone (1-888-BEST BUY) for BestBuy.com purchases; BestBuy.com requests cannot be completed in store or by email.',
    sourceUrl:
      'https://www.bestbuy.com/site/help-topics/price-match-guarantee/pcmcat290300050002.c?id=pcmcat290300050002',
    lastReviewed: PRICE_MATCH_LAST_REVIEWED,
  },
  {
    store: 'Walmart',
    domain: 'walmart.com',
    status: 'limited',
    summary:
      'In a Walmart U.S. store, the price of the identical item advertised on Walmart.com will be matched (restrictions apply; the store manager on duty has the final decision). Walmart.com itself offers no price matching — no competitor prices, no past-purchase price drops, and no marketplace prices.',
    howToClaim:
      'Tell a Walmart associate the Walmart.com price at checkout, in store. There is no price-match claim to make on Walmart.com.',
    sourceUrl: 'https://corporate.walmart.com/askwalmart/does-walmart-price-match',
    lastReviewed: PRICE_MATCH_LAST_REVIEWED,
  },
  {
    store: 'Target',
    domain: 'target.com',
    status: 'limited',
    summary:
      'Matches Target\u2019s own lower price — the identical item for less at Target.com, in Target stores, or with a Target Circle deal — at the time of purchase or within 14 days after purchase. The current policy covers Target\u2019s own prices only; competitor prices are not matched. A holiday window (November 1 to December 24, 2026) extends the own-price match for purchases in that period.',
    howToClaim:
      'In store, show proof of the current lower price at Guest Services; for Target.com or app purchases, chat online or call Guest Services at 1-800-591-3869. Original receipts or packing slips are required for adjustments within 14 days.',
    sourceUrl: 'https://www.target.com/help/article/000062256',
    lastReviewed: PRICE_MATCH_LAST_REVIEWED,
  },
  {
    store: 'Newegg',
    domain: 'newegg.com',
    status: 'limited',
    summary:
      'If the price of an eligible item sold and shipped by Newegg drops on Newegg.com within 7 calendar days of purchase, the difference is issued as a Newegg Customer Care card (good for 365 days). Competitor prices are explicitly excluded, as are marketplace sellers, clearance, open-box and refurbished items.',
    howToClaim:
      'Contact Newegg Customer Service within 7 calendar days of purchase; the lower price must be for the exact same item (same model, item number and specifications), in stock, and active at the time of the request.',
    sourceUrl: 'https://kb.newegg.com/knowledge-base/price-match-guarantee',
    lastReviewed: PRICE_MATCH_LAST_REVIEWED,
  },
  {
    store: 'Costco',
    domain: 'costco.com',
    status: 'limited',
    summary:
      'Costco.com orders: if the price drops within 30 days of purchase, a price match can be requested and, once approved, the credit is issued to the original form of payment (typically within 5 to 10 business days). Costco does not price-match other retailers, and does not match warehouse prices for Costco.com purchases. Precious metals are excluded.',
    howToClaim:
      'For Costco.com purchases, submit the "Request a Price Match" form; for warehouse purchases, ask at the Returns counter of the warehouse where the item was bought.',
    sourceUrl:
      'https://customerservice.costco.com/app/answers/detail/a_id/628/~/price-adjustment---costco.com-orders',
    lastReviewed: PRICE_MATCH_LAST_REVIEWED,
  },
  {
    store: 'Amazon',
    domain: 'amazon.com',
    status: 'no',
    summary:
      'Amazon does not offer price matching. Its own help page says it compares its prices to competitors itself and aims to keep them as low or lower — so there is no price-match claim to make. (The separate Pre-order Price Guarantee covers not-yet-released items only; it is not a price match.)',
    howToClaim:
      'There is no price-match claim process at Amazon. If a lower price appears elsewhere, the option is to return the item under Amazon\u2019s return policy and buy it where it is cheaper.',
    sourceUrl:
      'https://www.amazon.com/gp/help/customer/display.html?nodeId=G9EAYKPV5YYDB8P7',
    lastReviewed: PRICE_MATCH_LAST_REVIEWED,
  },
  {
    store: 'eBay',
    domain: 'ebay.com',
    status: 'varies',
    summary:
      'eBay is a marketplace of individual sellers, so there is no single eBay price-match policy. Whether a lower price elsewhere can be matched depends on the individual seller — always check the listing\u2019s terms before buying.',
    howToClaim:
      'Check the listing and contact the seller before buying; eBay itself offers no price-match claim process.',
    sourceUrl: 'https://www.ebay.com',
    lastReviewed: PRICE_MATCH_LAST_REVIEWED,
  },
];

const byName = new Map(
  PRICE_MATCH_POLICIES.map((p) => [p.store.toLowerCase(), p])
);

/** Curated policy for a store name, or null when not recorded. */
export function policyForStore(storeName: string | null | undefined): PriceMatchPolicy | null {
  if (!storeName) return null;
  return byName.get(storeName.trim().toLowerCase()) ?? null;
}

/** One row of the directory table: the store plus its policy (or null). */
export interface PriceMatchDirectoryRow {
  /** Store display name. */
  store: string;
  /** Curated policy, or null when nothing is recorded yet. */
  policy: PriceMatchPolicy | null;
}

/**
 * Directory rows for a list of store names: deduped (case-insensitive),
 * in first-seen order, with the curated policy attached where one
 * exists. Stores without a policy entry keep policy: null — the
 * caller renders "Not recorded yet", never a guess.
 */
export function priceMatchRowsForStores(storeNames: string[]): PriceMatchDirectoryRow[] {
  const seen = new Set<string>();
  const rows: PriceMatchDirectoryRow[] = [];
  for (const raw of storeNames) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ store: name, policy: policyForStore(name) });
  }
  return rows;
}

/** Filter values for the directory table (?status=…). */
export const PRICE_MATCH_FILTERS = [
  'all',
  'yes',
  'no',
  'limited',
  'varies',
  'not-recorded',
] as const;

export type PriceMatchFilter = (typeof PRICE_MATCH_FILTERS)[number];

/** Parse the ?status= query param; anything unknown reads as 'all'. */
export function parsePriceMatchFilter(
  searchParams: { status?: string | string[] } | undefined
): PriceMatchFilter {
  const raw = searchParams?.status;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value && (PRICE_MATCH_FILTERS as readonly string[]).includes(value)) {
    return value as PriceMatchFilter;
  }
  return 'all';
}

/** Keep only the rows matching a directory filter. */
export function filterPriceMatchRows(
  rows: PriceMatchDirectoryRow[],
  filter: PriceMatchFilter
): PriceMatchDirectoryRow[] {
  if (filter === 'all') return rows;
  if (filter === 'not-recorded') return rows.filter((r) => r.policy === null);
  return rows.filter((r) => r.policy?.status === filter);
}
