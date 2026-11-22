/**
 * CJ Affiliate feed — pure row transform / normalization.
 *
 * Pure functions, no DB, no network, no file access: the streaming
 * importer (scripts/import-cj-feed.ts) calls these per CSV record,
 * and the unit tests cover them without any fixture service.
 *
 * HEADER WARNING (verified 2026-11-21 against CJ's own sample
 * Shopping CSV, tests/fixtures/cj-sample-shopping.csv): the sample
 * uses UPPERCASE Google Shopping headers (ID, TITLE, LINK,
 * IMAGE_LINK, GOOGLE_PRODUCT_CATEGORY, ...) while the DHGate brief
 * lists lowercase names (id, title, link, image_link,
 * google_product_category, ...). The parser normalizes headers
 * case-insensitively, so both forms — and any mixed-case form —
 * map to the same canonical field. A header that is not in the
 * known list is ignored, never guessed.
 *
 * FILTER RULES (applied before any upsert, in this order — the
 * same order as the GraphQL mapper in lib/offers/cj-graphql.ts,
 * so the two importers agree on what a storable offer is):
 *   1. external id present (feed `id`)
 *   2. title present (a row with no title is not a displayable offer)
 *   3. availability is 'in stock' (Google Shopping) / 'in_stock'
 *   4. price parses and is > 0
 *   5. image_link is a valid http(s) URL
 *   6. with --only-with-gtin: a GS1-valid GTIN is required
 *   7. link is a valid http(s) URL (the affiliate click-through —
 *      an offer with no working link is not a displayable offer)
 * A row failing any rule is SKIPPED with a reason — never stored
 * half-parsed. GTINs are validated with lib/gtin.ts validateGtin
 * (GS1 check digit); an invalid GTIN becomes null, never a guess.
 * Prices like "29.99 USD" split into amount 29.99 + currency USD;
 * comma decimals are disambiguated ("29,99 EUR" → 29.99, never
 * 2,999 — see parseAmountText). A sale price whose EXPLICIT
 * currency differs from the list price's currency is dropped
 * (stored null); a bare sale figure inherits the row currency.
 */

import { validateGtin } from '@/lib/gtin';
import type { MerchantOfferRow, OfferAvailability } from '@/lib/offers/types';

/** Feed columns the importer reads (canonical, lowercase). */
export const CJ_FEED_COLUMNS = [
  'id',
  'title',
  'description',
  'link',
  'image_link',
  'availability',
  'price',
  'sale_price',
  'gtin',
  'mpn',
  'brand',
  'google_product_category',
  'product_type',
  'condition',
] as const;

export type CjFeedColumn = (typeof CJ_FEED_COLUMNS)[number];

/** A raw CSV record: header → cell value (headers already normalized). */
export type FeedRecord = Record<string, string | undefined>;

/**
 * Normalize one raw header to its canonical lowercase form:
 * trim, lowercase, collapse inner whitespace / hyphens to "_".
 * "GOOGLE_PRODUCT_CATEGORY" and "google_product_category" both
 * become "google_product_category". Unknown headers pass through
 * unchanged (lowercased) and are ignored by the transform.
 */
export function normalizeFeedHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/**
 * Normalize a whole header row. Returns a map from the raw header
 * (as it appears in the file) to the canonical field name, for
 * headers we recognize; unrecognized headers are dropped.
 */
export function normalizeFeedHeaders(headers: string[]): Record<string, CjFeedColumn> {
  const map: Record<string, CjFeedColumn> = {};
  for (const raw of headers) {
    const canonical = normalizeFeedHeader(raw);
    if ((CJ_FEED_COLUMNS as readonly string[]).includes(canonical)) {
      map[raw] = canonical as CjFeedColumn;
    }
  }
  return map;
}

/** Parsed money value: numeric amount + ISO currency code. */
export interface ParsedPrice {
  amount: number;
  currency: string;
}

/**
 * Parse the numeric part of a price string, disambiguating the
 * decimal separator. Google Shopping feeds mix formats:
 *   "1,299.00" → 1299  (comma = thousands, dot = decimal)
 *   "29,99"    → 29.99 (comma = decimal, European format)
 *   "1.299,00" → 1299  (dot = thousands, comma = decimal)
 *   "1,299"    → 1299  (3 digits after the comma = thousands)
 *   "1,5"      → 1.5   (1–2 digits after the comma = decimal)
 * When both separators are present, the LAST one is the decimal
 * mark. A malformed figure ("29.99.99", "1,2,3") returns null —
 * never a guessed amount. (The old code stripped every comma,
 * so "29,99 EUR" silently became 2,999.)
 */
export function parseAmountText(raw: string): number | null {
  const text = raw.trim();
  if (text === '') return null;
  const hasDot = text.includes('.');
  const hasComma = text.includes(',');
  let normalized: string;
  if (hasDot && hasComma) {
    normalized =
      text.lastIndexOf('.') > text.lastIndexOf(',')
        ? text.replace(/,/g, '')
        : text.replace(/\./g, '').replace(/,/g, '.');
  } else if (hasComma) {
    const afterLastComma = text.slice(text.lastIndexOf(',') + 1);
    normalized =
      afterLastComma.length === 3
        ? text.replace(/,/g, '')
        : text.replace(/,/g, '.');
  } else {
    normalized = text;
  }
  if (!/^[0-9]+(\.[0-9]+)?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

/**
 * The EXPLICIT 3-letter currency code in a raw price string, or
 * null when the string carries none ("19.99" has none; "19.99 EUR"
 * and "EUR 19.99" have EUR). A bare figure inherits the row's
 * currency — only an explicitly different code is a mismatch.
 */
export function explicitCurrencyCode(
  value: string | null | undefined,
): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const trailing = trimmed.match(/(?:^|\s)([A-Za-z]{3})\s*$/);
  if (trailing) return trailing[1].toUpperCase();
  const leading = trimmed.match(/^([A-Za-z]{3})\s+/);
  if (leading) return leading[1].toUpperCase();
  return null;
}

/**
 * Parse a Google Shopping price string: "29.99 USD", "1,299.00 USD",
 * "29,99 EUR", "29.99", "$29.99", "USD 29.99". Returns null when the
 * value is blank or has no parseable number. Currency defaults to
 * USD when no 3-letter code is present. The amount is never rounded
 * here — it is stored as the feed's exact figure.
 */
export function parseFeedPrice(value: string | null | undefined): ParsedPrice | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  // "29.99 USD" | "1,299.00 USD" | "29,99 EUR" | "29.99"
  const trailing = trimmed.match(/^([$€£]?)\s*([0-9][0-9.,]*)\s*([A-Za-z]{3})?$/);
  if (trailing) {
    const amount = parseAmountText(trailing[2]);
    if (amount === null) return null;
    // Group 3 is the currency: the new numeric class has no inner
    // decimal subgroup, so the code is group 3 (not 4 as before).
    return { amount, currency: (trailing[3] ?? 'USD').toUpperCase() };
  }
  // "USD 29.99" | "EUR 29,99"
  const leading = trimmed.match(/^([A-Za-z]{3})\s+([0-9][0-9.,]*)$/);
  if (leading) {
    const amount = parseAmountText(leading[2]);
    if (amount === null) return null;
    return { amount, currency: leading[1].toUpperCase() };
  }
  return null;
}

/**
 * Normalize a Google Shopping availability string to the DB enum.
 * "in stock" / "in_stock" → 'in_stock', "out of stock" →
 * 'out_of_stock', "preorder" → 'preorder', "backorder" →
 * 'backorder'. Anything else (including blank) → null, so the
 * row is skipped instead of stored with a guessed status.
 */
export function normalizeAvailability(value: string | null | undefined): OfferAvailability | null {
  if (value == null) return null;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'in_stock') return 'in_stock';
  if (normalized === 'out_of_stock') return 'out_of_stock';
  if (normalized === 'preorder') return 'preorder';
  if (normalized === 'backorder') return 'backorder';
  return null;
}

/**
 * Validate + normalize a GTIN. Returns the digits-only GTIN when
 * GS1-valid (8/12/13/14 digits with a correct check digit),
 * otherwise null. An invalid GTIN is dropped, never guessed —
 * the row can still import on its MPN.
 */
export function normalizeGtinValue(value: string | null | undefined): string | null {
  if (value == null || value.trim() === '') return null;
  const result = validateGtin(value);
  return result.valid ? result.normalized : null;
}

/** True when the value is a usable http(s) image URL (no fetch). */
export function isValidImageUrl(value: string | null | undefined): boolean {
  if (value == null) return false;
  const trimmed = value.trim();
  if (trimmed === '') return false;
  try {
    const url = new URL(trimmed);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
  } catch {
    return false;
  }
}

export interface TransformContext {
  network: string;
  advertiserId: string;
  advertiserName: string;
  /** --only-with-gtin: skip rows without a GS1-valid GTIN. */
  onlyWithGtin: boolean;
  /**
   * CJ_PSA_APPROVED. False by default: imported rows stay
   * is_public_live = false (hard compliance gate) until the CJ
   * PSA display rules are verified and the flag is set.
   */
  psaApproved: boolean;
  /** Sync timestamp stamped on every accepted row. */
  syncedAt: string;
}

export interface TransformResult {
  /** The upsert-ready row, or null when the record is skipped. */
  row: MerchantOfferRow | null;
  /** Skip reason when row is null, otherwise null. */
  skipReason: string | null;
  /** True when the record carries a GS1-valid GTIN or a non-empty MPN. */
  hasIdentifier: boolean;
}

function cell(record: FeedRecord, field: CjFeedColumn): string | undefined {
  // Records arrive with normalized (lowercase) keys from the
  // importer; fall back to a case-insensitive scan for safety.
  const direct = record[field];
  if (direct !== undefined) return direct;
  const wanted = field.toLowerCase();
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

/**
 * Transform one feed record into an upsert-ready merchant_offers
 * row, or skip it with a reason. Filter order: missing id →
 * missing title → availability not in_stock → price missing/≤ 0
 * → image invalid → (only-with-gtin) no valid GTIN →
 * affiliate link missing/invalid.
 */
export function transformFeedRow(record: FeedRecord, ctx: TransformContext): TransformResult {
  const externalId = cell(record, 'id')?.trim();
  if (!externalId) {
    return { row: null, skipReason: 'missing-id', hasIdentifier: false };
  }

  const title = cell(record, 'title')?.trim() ?? '';
  if (title === '') {
    return { row: null, skipReason: 'missing-title', hasIdentifier: false };
  }

  const availability = normalizeAvailability(cell(record, 'availability'));
  if (availability !== 'in_stock') {
    return { row: null, skipReason: 'not-in-stock', hasIdentifier: false };
  }

  const price = parseFeedPrice(cell(record, 'price'));
  if (price === null || price.amount <= 0) {
    return { row: null, skipReason: 'invalid-price', hasIdentifier: false };
  }

  const imageUrl = cell(record, 'image_link')?.trim() ?? '';
  if (!isValidImageUrl(imageUrl)) {
    return { row: null, skipReason: 'invalid-image', hasIdentifier: false };
  }

  const gtin = normalizeGtinValue(cell(record, 'gtin'));
  const mpnRaw = cell(record, 'mpn')?.trim() ?? '';
  const mpn = mpnRaw === '' ? null : mpnRaw;
  const hasIdentifier = gtin !== null || mpn !== null;

  if (ctx.onlyWithGtin && gtin === null) {
    return { row: null, skipReason: 'no-gtin', hasIdentifier };
  }

  // The affiliate click-through must be a usable http(s) URL, not
  // just present — an offer with no working link is not displayable.
  // Same bar as the GraphQL mapper ('missing-url') and the analyzer's
  // invalidAffiliateUrls metric (both use isValidImageUrl).
  const affiliateUrl = cell(record, 'link')?.trim() ?? '';
  if (!isValidImageUrl(affiliateUrl)) {
    return { row: null, skipReason: 'invalid-affiliate-url', hasIdentifier };
  }

  // sale_price is optional: unparseable or ≤ 0 becomes null
  // (the row still imports on its list price). A sale price with
  // an EXPLICITLY different currency than the list price is also
  // null — storing it under the row's currency would misstate the
  // discount. A bare sale figure ("19.99") inherits the row's
  // currency and is kept.
  const salePriceRaw = cell(record, 'sale_price');
  const salePriceParsed = parseFeedPrice(salePriceRaw);
  const saleCurrency = explicitCurrencyCode(salePriceRaw) ?? price.currency;
  const salePrice =
    salePriceParsed !== null &&
    salePriceParsed.amount > 0 &&
    saleCurrency === price.currency
      ? salePriceParsed.amount
      : null;

  const brand = cell(record, 'brand')?.trim() || null;
  const category =
    cell(record, 'google_product_category')?.trim() ||
    cell(record, 'product_type')?.trim() ||
    null;
  const description = cell(record, 'description')?.trim() || null;

  return {
    row: {
      network: ctx.network,
      advertiser_id: ctx.advertiserId,
      advertiser_name: ctx.advertiserName,
      external_product_id: externalId,
      gtin,
      mpn,
      brand,
      title,
      description,
      image_url: imageUrl,
      affiliate_url: affiliateUrl,
      price: price.amount,
      sale_price: salePrice,
      currency: price.currency,
      availability,
      category,
      is_public_live: ctx.psaApproved,
      last_synced_at: ctx.syncedAt,
    },
    skipReason: null,
    hasIdentifier,
  };
}
