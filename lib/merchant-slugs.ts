/**
 * FINAL 100% — ONE canonical merchant slug / provider-key mapping
 * (F-P1-11 code half, F-P2-06).
 *
 * The mismatch this fixes: the `merchants` table slug is
 * `best-buy`, the provider key / retailer override is `bestbuy`
 * (audit Worker C §2.3, Worker H §6 C-P2-4). No code reconciled
 * the two, so a future Best Buy client build — or any lookup that
 * used the wrong spelling — would miss. The `merchants` and
 * `retailers` tables are likewise unreconciled (audit F-P1-11):
 * 002 seeds eBay into `retailers`, the seeds put Amazon + Best
 * Buy into `merchants`, and nothing maps one table to the other.
 *
 * This module is the SINGLE place that mapping lives. Every
 * merchant lookup must go through it:
 * - `canonicalMerchantSlug`: any spelling ('bestbuy', 'best_buy',
 *   'Best-Buy') -> the `merchants`-table slug ('best-buy').
 * - `providerKeyForMerchantSlug`: canonical slug -> provider key
 *   ('best-buy' -> 'bestbuy'). The provider key is NOT a slug;
 *   the two namespaces are different and this function is the
 *   only bridge between them.
 * - `merchantSlugForProviderKey`: the reverse bridge.
 * - `reconcileMerchantRetailer`: the merchants<->retailers
 *   reconciliation record for one merchant (both tables keyed by
 *   the canonical slug; eBay exists in `retailers` only today and
 *   that is reported, not papered over).
 *
 * Nothing here touches the database or auto-creates a row: a
 * merchant that does not exist in a table is reported as missing
 * by the caller, never created by this mapping.
 */

/** One merchant, as both tables + the provider registry see it. */
export interface MerchantReconciliation {
  /** Canonical slug — the `merchants` table key. */
  merchantSlug: string;
  /** Slug used in the `retailers` table (same canonical slug). */
  retailerSlug: string;
  /** Provider-registry key (may differ from the slug). */
  providerKey: string;
  /** Display name. */
  name: string;
  /**
   * Whether the merchant is seeded in each table today (audit
   * truth, not a live check): eBay lives in `retailers` only —
   * its `merchants` row is owner-gated and does not exist yet.
   */
  seededInMerchants: boolean;
  seededInRetailers: boolean;
}

export const MERCHANT_RECONCILIATION: ReadonlyArray<MerchantReconciliation> = [
  {
    merchantSlug: 'amazon',
    retailerSlug: 'amazon',
    providerKey: 'amazon',
    name: 'Amazon',
    seededInMerchants: true,
    seededInRetailers: true,
  },
  {
    merchantSlug: 'best-buy',
    retailerSlug: 'bestbuy',
    providerKey: 'bestbuy',
    name: 'Best Buy',
    seededInMerchants: true,
    seededInRetailers: true,
  },
  {
    merchantSlug: 'ebay',
    retailerSlug: 'ebay',
    providerKey: 'ebay',
    name: 'eBay',
    // Audit Worker C §1.3: 002 seeds eBay into `retailers` only;
    // no seed or migration creates the `merchants` row.
    seededInMerchants: false,
    seededInRetailers: true,
  },
];

/** Alternate spellings that must resolve to the canonical slug. */
const SLUG_ALIASES: Readonly<Record<string, string>> = {
  bestbuy: 'best-buy',
  best_buy: 'best-buy',
  'best buy': 'best-buy',
  amazon: 'amazon',
  ebay: 'ebay',
};

/**
 * Canonicalize any merchant slug / provider key / display spelling
 * to the `merchants`-table slug. Unknown values are slugified
 * (lowercase, non-alphanumerics -> '-') and returned as-is — never
 * mapped to a different merchant.
 */
export function canonicalMerchantSlug(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === '') return null;
  if (SLUG_ALIASES[trimmed]) return SLUG_ALIASES[trimmed];
  const slugified = trimmed
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (slugified === '') return null;
  const known = MERCHANT_RECONCILIATION.find(
    (m) => m.merchantSlug === slugified || m.retailerSlug === slugified
  );
  return known ? known.merchantSlug : slugified;
}

/** Canonical merchant slug -> provider-registry key. */
export function providerKeyForMerchantSlug(
  slug: string | null | undefined
): string | null {
  const canonical = canonicalMerchantSlug(slug);
  if (!canonical) return null;
  const known = MERCHANT_RECONCILIATION.find((m) => m.merchantSlug === canonical);
  return known ? known.providerKey : canonical.replace(/-/g, '');
}

/** Provider-registry key -> canonical merchant slug. */
export function merchantSlugForProviderKey(
  key: string | null | undefined
): string | null {
  if (key === null || key === undefined) return null;
  const trimmed = key.trim().toLowerCase();
  if (trimmed === '') return null;
  const known = MERCHANT_RECONCILIATION.find((m) => m.providerKey === trimmed);
  if (known) return known.merchantSlug;
  return canonicalMerchantSlug(trimmed);
}

/**
 * Reconcile one merchant across the two tables. Returns null for
 * an unknown merchant (never invents a mapping). `matches` is
 * false when the caller-supplied retailer slug does not agree
 * with the canonical retailer slug for that merchant — the
 * `best-buy` vs `bestbuy` mismatch resolves here, in exactly one
 * place, instead of in every lookup.
 */
export function reconcileMerchantRetailer(
  merchantSlug: string | null | undefined,
  retailerSlug?: string | null | undefined
): {
  reconciliation: MerchantReconciliation;
  matches: boolean;
  mismatchReason: string | null;
} | null {
  const canonical = canonicalMerchantSlug(merchantSlug);
  if (!canonical) return null;
  const reconciliation = MERCHANT_RECONCILIATION.find(
    (m) => m.merchantSlug === canonical
  );
  if (!reconciliation) return null;
  if (retailerSlug === undefined || retailerSlug === null || retailerSlug.trim() === '') {
    return { reconciliation, matches: true, mismatchReason: null };
  }
  const retailerCanonical = retailerSlug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  const expected = reconciliation.retailerSlug.replace(/[^a-z0-9]+/g, '');
  const canonicalRetailer = canonicalMerchantSlug(retailerSlug)?.replace(/[^a-z0-9]+/g, '');
  const matches =
    retailerCanonical === expected || canonicalRetailer === canonical.replace(/[^a-z0-9]+/g, '');
  return {
    reconciliation,
    matches,
    mismatchReason: matches
      ? null
      : `Retailer slug "${retailerSlug}" does not match merchant "${reconciliation.merchantSlug}" (expected retailer slug "${reconciliation.retailerSlug}")`,
  };
}
