/**
 * Sustainability platform (Section 5, item 18).
 *
 * ONE carbon label per product, assembled from existing logic — never
 * duplicated, never mixed:
 * - RECORDED first: the product's recorded carbon footprint
 *   (migration 020, services/hardware-endurance.ts
 *   sustainabilityFromRecorded), ranked against its category baseline.
 * - ESTIMATE only when nothing is recorded: the Option 8 estimate
 *   (services/eco-footprint.ts estimateFootprint), always labeled
 *   "Estimate only — not a certified lifecycle assessment".
 * - UNKNOWN when neither exists: no number at all.
 *
 * Repairability comes from the Option 16 data
 * (services/repairability.ts) and is surfaced here as a browsable
 * database — products with a recorded repairability score, ranked by
 * index, with honest empty states for everything unrecorded.
 *
 * Refurbished listings come from the `refurbished_listings` table
 * (migration 029). The table starts EMPTY and stays empty until an
 * admin verifies a real listing against a real source — zero listings
 * is the honest state, never a placeholder. Every claim on this page
 * carries its source; nothing here is greenwashing.
 *
 * All reads are fail-safe: a missing migration or any error returns
 * nulls / [] — never a throw, never an invented value.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { getProducts } from '@/services/products';
import {
  estimateFootprint,
  bandLabel,
  type EcoBand,
  type EcoEstimate,
} from '@/services/eco-footprint';
import {
  sustainabilityFromRecorded,
  recordedBandLabel,
  getProductEndurance,
} from '@/services/hardware-endurance';
import {
  computeRepairabilityIndex,
  getProductRepairability,
  type RepairabilityIndex,
} from '@/services/repairability';

export type CarbonKind = 'recorded' | 'estimate' | 'unknown';

export interface CarbonLabel {
  kind: CarbonKind;
  /** kg CO2e, or null when unknown. */
  kgCO2e: number | null;
  /** Band (A+–E) against the category baseline, or null when unknown. */
  band: EcoBand | null;
  /** Category baseline in kg CO2e, or null when the category is unknown. */
  categoryBaseKg: number | null;
  /** The exact source line the UI must show next to the number. */
  sourceNote: string;
}

/**
 * One carbon label for a product. Recorded beats estimate; estimate
 * is labeled as an estimate; unknown shows no number. Pure — no I/O.
 */
export function resolveCarbonLabel(input: {
  recordedKg: number | null | undefined;
  category: string | null | undefined;
  priceUsd: number | null | undefined;
}): CarbonLabel {
  const recorded = sustainabilityFromRecorded({
    carbonFootprintKg: input.recordedKg,
    category: input.category,
  });
  if (recorded.status === 'recorded' && recorded.kgCO2e !== null) {
    return {
      kind: 'recorded',
      kgCO2e: recorded.kgCO2e,
      band: recorded.band,
      categoryBaseKg: recorded.categoryBaseKg,
      sourceNote:
        recorded.band !== null
          ? `Recorded footprint — ${recordedBandLabel(recorded.band)}.`
          : 'Recorded footprint — no category baseline to rank it against.',
    };
  }

  const estimate: EcoEstimate | null = estimateFootprint(input.category, input.priceUsd);
  if (estimate !== null) {
    return {
      kind: 'estimate',
      kgCO2e: estimate.kgCO2e,
      band: estimate.band,
      categoryBaseKg: estimate.categoryBaseKg,
      sourceNote: `Estimate only — not a certified lifecycle assessment. ${bandLabel(estimate.band)}.`,
    };
  }

  return {
    kind: 'unknown',
    kgCO2e: null,
    band: null,
    categoryBaseKg: null,
    sourceNote: 'No carbon data recorded for this product, and its category has no estimate baseline.',
  };
}

// ---------------------------------------------------------------------------
// Refurbished listings (migration 029 — starts empty by design)
// ---------------------------------------------------------------------------

export type RefurbishedCondition = 'certified-refurbished' | 'refurbished';

export interface RefurbishedListing {
  id: string;
  productId: string;
  merchantName: string;
  condition: RefurbishedCondition;
  priceUsd: number | null;
  currencyCode: string | null;
  listingUrl: string;
  sourceNote: string | null;
  verifiedAt: string | null;
}

interface RefurbishedRow {
  id: string;
  product_id: string;
  merchant_name: string;
  condition: string;
  price_usd: number | null;
  currency_code: string | null;
  listing_url: string;
  source_note: string | null;
  verified_at: string | null;
}

function mapRefurbished(row: RefurbishedRow): RefurbishedListing | null {
  if (row.condition !== 'certified-refurbished' && row.condition !== 'refurbished') return null;
  const price =
    typeof row.price_usd === 'number' && Number.isFinite(row.price_usd) && row.price_usd > 0
      ? row.price_usd
      : null;
  return {
    id: row.id,
    productId: row.product_id,
    merchantName: row.merchant_name,
    condition: row.condition,
    priceUsd: price,
    currencyCode: row.currency_code,
    listingUrl: row.listing_url,
    sourceNote: row.source_note,
    verifiedAt: row.verified_at,
  };
}

/**
 * Verified refurbished listings — for one product, or all products
 * when no productId is given. [] when none exist or the table is
 * missing (migration 029 not run). Never throws.
 */
export async function getRefurbishedListings(
  supabase: AnySupabaseClient,
  productId?: string
): Promise<RefurbishedListing[]> {
  try {
    let query = supabase
      .from('refurbished_listings')
      .select(
        'id, product_id, merchant_name, condition, price_usd, currency_code, listing_url, source_note, verified_at'
      )
      .order('verified_at', { ascending: false });
    if (productId) query = query.eq('product_id', productId);
    const { data, error } = await query;
    if (error || !data) {
      if (error) {
        logger.warn('getRefurbishedListings: query failed (029 may not be run)', {
          error: error.message,
        });
      }
      return [];
    }
    const out: RefurbishedListing[] = [];
    for (const row of data as RefurbishedRow[]) {
      const mapped = mapRefurbished(row);
      if (mapped) out.push(mapped);
    }
    return out;
  } catch (err) {
    logger.warn('getRefurbishedListings: unexpected error', { error: String(err) });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Repairability database (Option 16 data, browsable)
// ---------------------------------------------------------------------------

export interface RepairabilityRow {
  productId: string;
  slug: string;
  name: string;
  brand: string | null;
  category: string | null;
  index: RepairabilityIndex;
}

/**
 * Every catalog product with a recorded repairability score, ranked
 * best index first. Products without a recorded score are excluded
 * (they have no index to rank) — the page says how many are missing
 * instead of inventing scores. Fail-safe: [] on any error.
 */
export async function getRepairabilityDatabase(
  supabase: AnySupabaseClient
): Promise<{ rows: RepairabilityRow[]; recordedCount: number; totalCount: number }> {
  const empty = { rows: [], recordedCount: 0, totalCount: 0 };
  try {
    const { products } = await getProducts(supabase, { pageSize: 100 });
    const rows: RepairabilityRow[] = [];
    for (const product of products) {
      const data = await getProductRepairability(supabase, product.id);
      const index = computeRepairabilityIndex(data);
      if (index.index === null) continue;
      rows.push({
        productId: product.id,
        slug: product.slug,
        name: product.name,
        brand: product.brand,
        category: product.category,
        index,
      });
    }
    rows.sort((a, b) => (b.index.index ?? 0) - (a.index.index ?? 0));
    return { rows, recordedCount: rows.length, totalCount: products.length };
  } catch (err) {
    logger.warn('getRepairabilityDatabase: unexpected error', { error: String(err) });
    return empty;
  }
}

// ---------------------------------------------------------------------------
// Per-product sustainability summary (carbon + repairability + refurbished)
// ---------------------------------------------------------------------------

export interface SustainabilitySummary {
  carbon: CarbonLabel;
  repairability: RepairabilityIndex;
  refurbished: RefurbishedListing[];
}

/**
 * Full sustainability summary for one product. Every part is
 * fail-safe on its own — a missing migration in one area never
 * breaks the others. Never throws.
 */
export async function getSustainabilitySummary(
  supabase: AnySupabaseClient,
  product: {
    id: string;
    category: string | null;
    lowestPriceUsd: number | null;
  }
): Promise<SustainabilitySummary> {
  const [endurance, repairabilityData, refurbished] = await Promise.all([
    getProductEndurance(supabase, product.id),
    getProductRepairability(supabase, product.id),
    getRefurbishedListings(supabase, product.id),
  ]);
  return {
    carbon: resolveCarbonLabel({
      recordedKg: endurance.carbonFootprintKg,
      category: product.category,
      priceUsd: product.lowestPriceUsd,
    }),
    repairability: computeRepairabilityIndex(repairabilityData),
    refurbished,
  };
}
