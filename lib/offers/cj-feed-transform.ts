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
 * FILTER RULES (applied before any upsert, in this order):
 *   1. external id present (feed `id`)
 *   2. availability is 'in stock' (Google Shopping) / 'in_stock'
 *   3. price parses and is > 0
 *   4. image_link is a valid http(s) URL
 *   5. with --only-with-gtin: a GS1-valid GTIN is required
 * A row failing any rule is SKIPPED with a reason — never stored
 * half-parsed. GTINs are validated with lib/gtin.ts validateGtin
 * (GS1 check digit); an invalid GTIN becomes null, never a guess.
 * Prices like "29.99 USD" split into amount 29.99 + currency USD.
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
 * Parse a Google Shopping price string: "29.99 USD", "1,299.00 USD",
 * "29.99", "$29.99", "USD 29.99". Returns null when the value is
 * blank or has no parseable number. Currency defaults to USD when
 * no 3-letter code is present. The amount is never rounded here —
 * it is stored as the feed's exact figure.
 */
export function parseFeedPrice(value: string | null | undefined): ParsedPrice | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  // "29.99 USD" | "1,299.00 USD" | "29.99"
  const trailing = trimmed.match(/^([$€£]?)\s*([0-9][0-9,]*(\.[0-9]+)?)\s*([A-Za-z]{3})?$/);
  if (trailing) {
    const amount = Number(trailing[2].replace(/,/g, ''));
    if (!Number.isFinite(amount)) return null;
    return { amount, currency: (trailing[4] ?? 'USD').toUpperCase() };
  }
  // "USD 29.99"
  const leading = trimmed.match(/^([A-Za-z]{3})\s+([0-9][0-9,]*(\.[0-9]+)?)$/);
  if (leading) {
    const amount = Number(leading[2].replace(/,/g, ''));
    if (!Number.isFinite(amount)) return null;
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
 * availability not in_stock → price missing/≤ 0 → image invalid
 * → (only-with-gtin) no valid GTIN.
 */
export function transformFeedRow(record: FeedRecord, ctx: TransformContext): TransformResult {
  const externalId = cell(record, 'id')?.trim();
  if (!externalId) {
    return { row: null, skipReason: 'missing-id', hasIdentifier: false };
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

  // sale_price is optional: unparseable or ≤ 0 becomes null
  // (the row still imports on its list price).
  const salePriceParsed = parseFeedPrice(cell(record, 'sale_price'));
  const salePrice =
    salePriceParsed !== null && salePriceParsed.amount > 0
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
      title: cell(record, 'title')?.trim() ?? '',
      description,
      image_url: imageUrl,
      affiliate_url: cell(record, 'link')?.trim() ?? '',
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
