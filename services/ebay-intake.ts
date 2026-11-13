/**
 * Section 15, P3-1 — eBay Browse → catalog-intake mapping (PURE).
 *
 * No DB access, no network: this module turns eBay `itemSummary`
 * listings into `IntakeRowInput` rows and runs them through the
 * Section 9 `reviewIntakeRows` validator, plus the one dedupe rule
 * the CSV pipeline cannot know — the eBay `itemId`.
 *
 * FIELD MAPPING (audit Chunk 8):
 *   title        → products.name (admin-edited later; eBay titles
 *                  are keyword-stuffed, so the name is a starting
 *                  point, never a final value)
 *   slug         → admin-supplied, must pass SLUG_PATTERN; NEVER
 *                  auto-derived from itemId (an itemId slug would
 *                  be meaningless and unfindable)
 *   brand /
 *   category     → NOT in the listing; the admin must supply both
 *                  (they are required intake columns — an empty
 *                  value is an `error` row, never a guess)
 *   price.value  → merchant_products.price (null → empty price →
 *                  `error` row; a negative price is already `null`
 *                  in the adapter, so it can never reach here)
 *   price.currency → currencies lookup (unknown code → `error` row)
 *   itemWebUrl   → merchant_products.url (stored by the approve
 *                  route from the intake plan — see planIntakeInsert;
 *                  the URL itself is carried in the provenance)
 *   image.imageUrl → products.image_url (hotlink only — the image
 *                  is never downloaded or re-hosted)
 *   itemId       → merchant_products.merchant_sku (the durable
 *                  dedupe key; also recorded in the audit log)
 *
 * DEDUPE (in order, after the shared review):
 *   1. slug exists → `duplicate` (shared rule);
 *   2. same normalized name|brand → `near-duplicate`, admin opt-in
 *      only (shared rule);
 *   3. itemId already present as `merchant_sku` for eBay → NEW
 *      `duplicate` (this module's rule — the caller supplies the
 *      live set of eBay SKUs; the same itemId twice in one batch
 *      is a duplicate too).
 * NO fuzzy title matching, never auto-merge: a listing that is
 * merely similar to an existing product is a `near-duplicate` at
 * most, and only the admin's explicit include inserts it.
 *
 * PROVENANCE: `products` / `merchant_products` have no `source`
 * column, so the origin is recorded in `admin_audit_logs.details`
 * by the approve route with the NEW source value
 * `'ebay-browse-api'` (distinct from `'manual-intake'`), plus the
 * per-row `ebay_item_id`, `itemWebUrl`, `fetched_at` and search
 * query built by `buildEbayIntakeProvenance` below.
 *
 * HONEST LABELLING: nothing here writes price history, a Deal
 * Score, or an alert. An approved eBay row is ONE snapshot of an
 * ephemeral asking price; the UI labels it "Live eBay asking
 * price, checked <timestamp>" with the preview-time
 * `data_freshness` (Sections 21–25, Stage D, R2 — the approve
 * stamps the preview fetch time, never the approve time), shows
 * the condition, and links to the live listing. A listing that
 * later vanishes never triggers an alert.
 */

import {
  reviewIntakeRows,
  type IntakeCatalogContext,
  type IntakeReview,
  type IntakeReviewedRow,
  type IntakeRowInput,
} from './catalog-intake';
import { validateImageUrl } from '@/lib/image-url';
import { EBAY_INTAKE_SOURCE } from '@/lib/intake-sources';
import type { EbayListing } from './ebay-browse';

/** Stored in admin_audit_logs.details for every eBay intake batch. */
export { EBAY_INTAKE_SOURCE };

/** Merchant slug the intake rows are filed under (never auto-created). */
export const EBAY_MERCHANT_SLUG = 'ebay';

/** Admin-supplied fields the eBay listing itself does not carry. */
export interface EbayIntakeFieldOverrides {
  brand: string;
  category: string;
  slug: string;
  description?: string;
}

export interface EbayIntakeProvenanceItem {
  rowNumber: number;
  ebay_item_id: string;
  itemWebUrl: string;
  condition: string | null;
}

export interface EbayIntakeProvenance {
  source: typeof EBAY_INTAKE_SOURCE;
  query: string;
  fetched_at: string;
  items: EbayIntakeProvenanceItem[];
}

/**
 * Map one eBay listing to an intake row. The price is carried as a
 * string because `reviewIntakeRows` parses + validates it: a null
 * price becomes an empty string and fails validation as an `error`
 * row ("Price is required") instead of silently becoming zero.
 */
export function mapEbayListingToIntakeRow(
  listing: EbayListing,
  rowNumber: number,
  fields: EbayIntakeFieldOverrides
): IntakeRowInput {
  // Section 20, §12 #94 — the listing image is merchant data, not
  // admin-typed, so an invalid image URL is DROPPED here (the
  // product falls back to the honest placeholder) instead of
  // failing the whole row: the admin cannot fix a merchant URL,
  // and a bad URL must never be stored. The shared review
  // (reviewIntakeRows) still validates any image URL that does
  // reach it, so this is a second layer, not the only one.
  const imageCheck = listing.imageUrl ? validateImageUrl(listing.imageUrl) : null;
  const imageUrl = imageCheck?.valid ? (imageCheck.normalized ?? undefined) : undefined;
  return {
    rowNumber,
    name: listing.title,
    slug: fields.slug,
    brand: fields.brand,
    category: fields.category,
    price: listing.price === null ? '' : String(listing.price),
    currency: listing.currency ?? '',
    merchant: EBAY_MERCHANT_SLUG,
    ...(fields.description ? { description: fields.description } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    // Section 21–25, Stage C (B12) — the listing's GTIN, when
    // the listing carries one (extractEbayGtin, GS1-validated).
    // Null/absent stays absent: the shared review validates any
    // GTIN that reaches it, and a listing without one is
    // GTIN-less, never filled in.
    ...(listing.gtin ? { gtin: listing.gtin } : {}),
    sku: listing.itemId,
  };
}

export function buildEbayIntakeProvenance(
  query: string,
  fetchedAt: string,
  listings: EbayListing[],
  rows: IntakeRowInput[]
): EbayIntakeProvenance {
  const rowByItemId = new Map<string, IntakeRowInput>();
  for (const row of rows) {
    if (row.sku) rowByItemId.set(row.sku, row);
  }
  return {
    source: EBAY_INTAKE_SOURCE,
    query,
    fetched_at: fetchedAt,
    items: listings
      .filter((l) => rowByItemId.has(l.itemId))
      .map((l) => ({
        rowNumber: rowByItemId.get(l.itemId)!.rowNumber,
        ebay_item_id: l.itemId,
        itemWebUrl: l.itemWebUrl,
        condition: l.condition,
      })),
  };
}

export interface EbayIntakeReviewResult {
  review: IntakeReview;
  /** Raw rows, for the approve step (which re-validates them). */
  rows: IntakeRowInput[];
  /** eBay-itemId duplicates found by rule (3), in the summary too. */
  ebayDuplicates: number;
  provenance: EbayIntakeProvenance;
}

/**
 * Map listings → intake rows → shared review → itemId dedupe.
 *
 * `fieldsByItemId` holds the admin's per-listing brand/category/
 * slug. A listing with NO entry is skipped (it cannot be reviewed
 * without a slug/brand/category) and reported in `skippedItems`.
 * `existingEbaySkus` is the live set of `merchant_sku` values
 * already stored for the eBay merchant.
 */
export function reviewEbayIntakeRows(
  listings: EbayListing[],
  fieldsByItemId: Map<string, EbayIntakeFieldOverrides>,
  context: IntakeCatalogContext,
  existingEbaySkus: Set<string>,
  provenanceInput: { query: string; fetchedAt: string }
): EbayIntakeReviewResult & { skippedItems: string[] } {
  const rows: IntakeRowInput[] = [];
  const skippedItems: string[] = [];
  let rowNumber = 0;
  for (const listing of listings) {
    const fields = fieldsByItemId.get(listing.itemId);
    if (!fields) {
      skippedItems.push(listing.itemId);
      continue;
    }
    rowNumber += 1;
    rows.push(mapEbayListingToIntakeRow(listing, rowNumber, fields));
  }

  const review = reviewIntakeRows(rows, context);

  // Rule (3): itemId already in the catalog as an eBay
  // merchant_sku, or repeated in this batch. Only valid /
  // near-duplicate rows are reclassified — an `error` row keeps
  // its errors (the admin must fix the fields first).
  const seenItemIds = new Set<string>();
  let ebayDuplicates = 0;
  // ItemId per reviewed row, from the raw input rows (a reviewed
  // row's `data` is null for duplicates/errors, so it cannot be
  // read back from the review itself).
  const itemIdByRowNumber = new Map<number, string>();
  for (const input of rows) {
    if (input.sku) itemIdByRowNumber.set(input.rowNumber, input.sku);
  }
  // Every itemId in the batch counts as "seen" in row order, so a
  // repeat is a duplicate even when the first row was an error or
  // a slug-duplicate (its itemId still entered the catalog's
  // review — the second row must not slip through as valid).
  const reviewedRows: IntakeReviewedRow[] = review.rows.map((r) => {
    const itemId = itemIdByRowNumber.get(r.rowNumber) ?? '';
    const alreadySeen = itemId !== '' && seenItemIds.has(itemId);
    if (itemId !== '') seenItemIds.add(itemId);
    if (r.status !== 'valid' && r.status !== 'near-duplicate') {
      return r;
    }
    if (!itemId) return r;
    const alreadyInCatalog = existingEbaySkus.has(itemId);
    if (!alreadyInCatalog && !alreadySeen) return r;
    ebayDuplicates += 1;
    return {
      ...r,
      status: 'duplicate',
      duplicateOf: alreadyInCatalog
        ? `eBay item ${itemId} is already in the catalog`
        : `eBay item ${itemId} appears twice in this batch`,
      data: null,
    };
  });

  const summary = {
    total: reviewedRows.length,
    valid: reviewedRows.filter((r) => r.status === 'valid').length,
    errors: reviewedRows.filter((r) => r.status === 'error').length,
    duplicates: reviewedRows.filter((r) => r.status === 'duplicate').length,
    nearDuplicates: reviewedRows.filter((r) => r.status === 'near-duplicate').length,
  };

  return {
    review: { rows: reviewedRows, summary },
    rows,
    ebayDuplicates,
    skippedItems,
    provenance: buildEbayIntakeProvenance(
      provenanceInput.query,
      provenanceInput.fetchedAt,
      listings,
      rows
    ),
  };
}
