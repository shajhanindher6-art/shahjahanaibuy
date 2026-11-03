/**
 * Return Policy & Warranty Matrix — general policy summaries only.
 *
 * HONESTY RULES (do not weaken them):
 * - Every entry is a GENERAL, well-known policy summary as of
 *   November 2026 ("last reviewed" stamp is shown in the UI). Store
 *   policies change and vary by product category, membership, and
 *   seller — the matrix ALWAYS carries the disclaimer "General policy
 *   summary — always verify at the retailer's site before purchase".
 * - Anything seller-dependent (marketplace sellers, e.g. eBay
 *   sellers, AliExpress sellers) reads "Varies by seller — check the
 *   listing", never an invented window or fee.
 * - Warranty is manufacturer-dependent: the matrix NEVER invents a
 *   warranty length for a product. Warranty handling is described as
 *   "via the manufacturer" unless a store explicitly offers its own
 *   protection plan, in which case it is labeled as an optional
 *   add-on, not a product warranty.
 * - No deep links to guessed retailer help URLs: the UI links only to
 *   retailer homepages/domains it knows, or shows no link at all.
 * - A store with no policy entry is OMITTED from the matrix with a
 *   note — never filled with a guess.
 */

/** One row of the matrix. All strings are general summaries. */
export interface ReturnPolicyRow {
  /** Store display name, e.g. "Amazon". */
  store: string;
  /** Store homepage domain (for a plain-text reference, not a deep link). */
  domain: string;
  /** Return window summary, or null when it varies by seller. */
  returnWindow: string | null;
  /** Restocking-fee summary, or null when it varies by seller. */
  restockingFee: string | null;
  /** Warranty-handling summary (never a product warranty length). */
  warrantyHandling: string;
  /** Short note (membership, exceptions, exchange). */
  note: string;
  /** True when the store is a marketplace (terms vary by seller). */
  marketplace: boolean;
}

/** Stamp shown in the UI so staleness is visible, not hidden. */
export const POLICY_LAST_REVIEWED = 'November 2026';

/**
 * General policy summaries for the stores SmartBuy lists most often.
 * Deliberately conservative: where a store's policy depends on the
 * seller, category, or membership tier, the row says so instead of
 * picking one number.
 */
export const RETURN_POLICIES: ReturnPolicyRow[] = [
  {
    store: 'Amazon',
    domain: 'amazon.com',
    returnWindow: 'Generally 30 days from delivery for most items',
    restockingFee: 'Generally none for most items; some categories excepted',
    warrantyHandling: 'Manufacturer warranty; Amazon offers optional protection plans at checkout',
    note: 'Exceptions apply (e.g. some electronics, grocery, personalized items). Prime membership does not change the standard window.',
    marketplace: false,
  },
  {
    store: 'Best Buy',
    domain: 'bestbuy.com',
    returnWindow: 'Generally 15 days; 60 days for Plus/Total members',
    restockingFee: 'A restocking fee may apply to some product categories — check the listing',
    warrantyHandling: 'Manufacturer warranty; Geek Squad protection plans are optional add-ons',
    note: 'Return windows vary by membership tier and product category.',
    marketplace: false,
  },
  {
    store: 'Walmart',
    domain: 'walmart.com',
    returnWindow: 'Generally 90 days for most items',
    restockingFee: 'Generally none for most items; some electronics excepted',
    warrantyHandling: 'Manufacturer warranty; Walmart offers optional protection plans at checkout',
    note: 'Marketplace items sold by third parties follow that seller’s policy.',
    marketplace: false,
  },
  {
    store: 'Target',
    domain: 'target.com',
    returnWindow: 'Generally 90 days; 120 days for Target Circle members on most items',
    restockingFee: 'Generally none for most items',
    warrantyHandling: 'Manufacturer warranty; Target offers optional protection plans on some electronics',
    note: 'Electronics and entertainment items may have shorter windows.',
    marketplace: false,
  },
  {
    store: 'eBay',
    domain: 'ebay.com',
    returnWindow: null,
    restockingFee: null,
    warrantyHandling: 'Manufacturer warranty where applicable; eBay Money Back Guarantee covers items not as described',
    note: 'Returns depend on the individual seller — always check the listing’s return policy before buying.',
    marketplace: true,
  },
  {
    store: 'AliExpress',
    domain: 'aliexpress.com',
    returnWindow: null,
    restockingFee: null,
    warrantyHandling: 'Varies by seller; buyer protection covers items not received or not as described',
    note: 'Return windows and fees are set per seller and per listing — always check the listing before buying.',
    marketplace: true,
  },
];

const byName = new Map(RETURN_POLICIES.map((r) => [r.store.toLowerCase(), r]));

/** Policy row for a merchant name, or null when the store has no entry. */
export function policyForStore(storeName: string | null | undefined): ReturnPolicyRow | null {
  if (!storeName) return null;
  return byName.get(storeName.trim().toLowerCase()) ?? null;
}

/**
 * Matrix rows for a product: priced merchants first (in the order the
 * caller passes them, i.e. cheapest first), then any remaining
 * policy-table stores the caller asked to include. Stores without a
 * policy entry are never invented — the caller decides whether to
 * include them as a "Varies" row or omit them; this helper only
 * returns rows for stores that HAVE an entry.
 */
export function matrixRowsForStores(storeNames: string[]): ReturnPolicyRow[] {
  const seen = new Set<string>();
  const rows: ReturnPolicyRow[] = [];
  for (const name of storeNames) {
    const row = policyForStore(name);
    if (row && !seen.has(row.store)) {
      seen.add(row.store);
      rows.push(row);
    }
  }
  return rows;
}
