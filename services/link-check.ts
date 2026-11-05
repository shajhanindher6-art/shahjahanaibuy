/**
 * Link checker — Option 11, Phase 2 (AI Trust & Protection Layer).
 *
 * PURE parser: a pasted product/seller link is parsed ON THE DEVICE.
 * No scraping, no external fetch, nothing sent, nothing stored. The
 * only question it answers is: does this link's domain match a
 * retailer SmartBuy already prices for this product (or a known
 * retailer family at all)?
 *
 * HONESTY RULES (do not weaken them):
 * - A domain match is NOT proof that a specific listing is genuine,
 *   authorized, or the same product — it only says the domain
 *   belongs to a retailer SmartBuy prices. The UI must say so.
 * - An unknown domain is NEVER labeled fake/scam/counterfeit. It is
 *   "unknown seller — not in SmartBuy's priced-retailer list",
 *   with advice to verify the seller before buying.
 * - A known retailer that does not price THIS product here is
 *   reported exactly that way, never as a seller of this product.
 * - An unparseable input is reported as unparseable, never guessed.
 */

export type LinkCheckVerdict = 'priced-seller' | 'known-not-priced' | 'unknown' | 'invalid';

export interface LinkCheckResult {
  verdict: LinkCheckVerdict;
  /** Hostname that was parsed, or null when unparseable. */
  hostname: string | null;
  /** Matched priced merchant name, when verdict is 'priced-seller'. */
  merchantName: string | null;
  /** Plain-language line for the UI. */
  message: string;
}

/** A priced merchant with a domain derived from its listing URL. */
export interface PricedMerchantDomain {
  merchantName: string;
  /** Lowercase hostname, e.g. "amazon.com". Null when underivable. */
  hostname: string | null;
}

/**
 * Normalize a hostname for comparison: lowercase, strip a single
 * leading "www.", strip a trailing dot. Subdomains other than www
 * are kept (e.g. "smile.amazon.com" stays distinct).
 */
export function normalizeHostname(hostname: string): string {
  let h = hostname.trim().toLowerCase();
  if (h.endsWith('.')) h = h.slice(0, -1);
  if (h.startsWith('www.')) h = h.slice(4);
  return h;
}

/** Extract a hostname from a listing URL, or null when unparseable. */
export function hostnameFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return normalizeHostname(new URL(url).hostname);
  } catch {
    return null;
  }
}

/**
 * Known retailer domain families (from the site's own region/store
 * data — Amazon's regional domains and Best Buy). Used ONLY to
 * recognize a known retailer that does not price this product here;
 * a priced match always comes from the product's own merchants.
 */
export function knownRetailerFamily(hostname: string): string | null {
  const h = normalizeHostname(hostname);
  if (/^amazon\.[a-z.]+$/.test(h) || h.endsWith('.amazon.com')) return 'Amazon';
  if (h === 'bestbuy.com' || h.endsWith('.bestbuy.com')) return 'Best Buy';
  return null;
}

/**
 * Check a pasted link against the product's priced merchants.
 * `priced` comes from the product page's own merchant listings
 * (names + listing-URL hostnames) — never from the pasted link.
 */
export function checkLink(
  pasted: string,
  priced: PricedMerchantDomain[]
): LinkCheckResult {
  const raw = (pasted ?? '').trim();
  if (!raw) {
    return {
      verdict: 'invalid',
      hostname: null,
      merchantName: null,
      message: 'Paste a product or seller link to check it.',
    };
  }
  // Tolerate a pasted host without a scheme ("amazon.com/dp/…").
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let hostname: string;
  try {
    hostname = normalizeHostname(new URL(candidate).hostname);
  } catch {
    return {
      verdict: 'invalid',
      hostname: null,
      merchantName: null,
      message: 'Could not parse this link — paste a full product or seller URL.',
    };
  }
  if (!hostname) {
    return {
      verdict: 'invalid',
      hostname: null,
      merchantName: null,
      message: 'Could not parse this link — paste a full product or seller URL.',
    };
  }

  const pricedMatch = priced.find(
    (m) => m.hostname !== null && m.hostname === hostname
  );
  if (pricedMatch) {
    return {
      verdict: 'priced-seller',
      hostname,
      merchantName: pricedMatch.merchantName,
      message:
        `Domain matches ${pricedMatch.merchantName}, a retailer SmartBuy prices for this product. ` +
        `This confirms the domain only — it does not prove this specific listing is genuine or the same product.`,
    };
  }

  const family = knownRetailerFamily(hostname);
  if (family) {
    return {
      verdict: 'known-not-priced',
      hostname,
      merchantName: null,
      message:
        `${family} is a known retailer, but it does not price this product on SmartBuy. ` +
        `Check the retailer's own listing before buying.`,
    };
  }

  return {
    verdict: 'unknown',
    hostname,
    merchantName: null,
    message:
      `Unknown seller — ${hostname} is not in SmartBuy's priced-retailer list for this product. ` +
      `This is not a fake/scam verdict; verify the seller before buying.`,
  };
}
