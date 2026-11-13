/**
 * Final 100% Product & Real Data Completion — product-level source
 * attribution reader (F-P1-05, dashboard half).
 *
 * The gap: source attribution has no product-level home. A
 * product's origin lives in three places that no single surface
 * reads together:
 * - `merchant_products.price_source` (migration 045) — which
 *   merchant supplied the cheapest listing's price, and when it
 *   was verified;
 * - `product_sources` rows — written by the pipeline per provider
 *   fetch (provider key, source URL, last fetched at), 0 rows
 *   live because no provider feeds the pipeline in production;
 * - per-spec attribution (`product_attributes.source` /
 *   `verified_at`, migration 058) — read by
 *   `listProductSpecsWithAttribution`, reused here for its counts.
 *
 * This module is the fail-closed reader that gathers those three
 * legs for one product. It is the attribution surface the
 * dashboard and the admin product detail render from. It invents
 * nothing:
 * - 045 unapplied → the merchant leg retries without
 *   `price_source` / `price_verified_at` and reports
 *   `columnsMissing: true` (the price source is then unknown,
 *   not "manual-intake" — the live "manual-intake" label is a
 *   fail-open default, see audit C-7, and is never repeated here
 *   as a stored fact);
 * - `product_sources` table missing → `productSourcesMissing:
 *   true`, empty list;
 * - no leg carries anything → `hasAnyAttribution: false` and the
 *   UI renders "No source recorded for this product", never a
 *   guessed source.
 *
 * The product origin recorded only in the admin audit log's
 * metadata is deliberately NOT surfaced here: an audit trail is
 * not a product attribute, and a product surface must not present
 * it as one.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { listProductSpecsWithAttribution } from './product-attributes';

export interface MerchantAttribution {
  merchantId: string;
  merchantName: string | null;
  /** Recorded price source, or null when the 045 column does not exist yet. */
  priceSource: string | null;
  priceVerifiedAt: string | null;
}

export interface ProductSourceAttribution {
  providerKey: string;
  retailerId: string;
  externalId: string;
  /**
   * FINAL 100% (W3, F-P1-05) — always null: `product_sources`
   * has NO source_url column (migration 002 defines id,
   * product_id, retailer_id, external_id, provider_key,
   * last_fetched_at, raw, created_at). The per-observation URL
   * lives on price_history.url / merchant_products.url, not here.
   * Kept in the interface so existing readers keep compiling;
   * never populated with a guessed URL.
   */
  sourceUrl: string | null;
  lastFetchedAt: string | null;
}

export interface ProductAttribution {
  productId: string;
  merchantSources: MerchantAttribution[];
  productSources: ProductSourceAttribution[];
  /** Stored specs that carry a recorded source. */
  specsAttributed: number;
  /** Stored specs in total. */
  specsTotal: number;
  /** True when the 058 per-spec attribution columns are missing. */
  specsAttributionMissing: boolean;
  /** True when any leg above recorded anything at all. */
  hasAnyAttribution: boolean;
  /** True when the 045 price_source columns do not exist yet. */
  columnsMissing: boolean;
  /** True when the product_sources table does not exist yet. */
  productSourcesMissing: boolean;
  /** Plain-language notes about what could not be read. */
  notes: string[];
  /**
   * FINAL 100% (W3, F-P1-05) — distinct sources across ALL legs
   * (merchant listings, product_sources, price_history), sorted.
   * Empty = unattributed.
   */
  sources: string[];
  /**
   * The single source, only when exactly one distinct source
   * exists across all legs. Null with several (ambiguous — a
   * product can have listings from several sources, which is why
   * migration 045 deliberately adds NO source column to
   * `products`) or none.
   */
  primarySource: string | null;
  /**
   * Distinct sources on the product's price_history rows
   * (migration 057). Empty while 057 is unapplied.
   */
  historySources: string[];
}

function isUndefinedColumnError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42703';
}

function isMissingTableError(error: { code?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205';
}

/**
 * Read one product's source attribution. Never throws; a failed
 * leg yields an empty leg plus a note, never a guessed source.
 */
export async function getProductAttribution(
  supabase: AnySupabaseClient,
  productId: string
): Promise<ProductAttribution> {
  const result: ProductAttribution = {
    productId,
    merchantSources: [],
    productSources: [],
    specsAttributed: 0,
    specsTotal: 0,
    specsAttributionMissing: false,
    hasAnyAttribution: false,
    columnsMissing: false,
    productSourcesMissing: false,
    notes: [],
    sources: [],
    primarySource: null,
    historySources: [],
  };

  // Leg 1 — merchant listings: price_source + verified_at (045).
  try {
    type MerchantRow = {
      merchant_id: string;
      price_source?: string | null;
      price_verified_at?: string | null;
    };
    const runMerchantQuery = async (withSource: boolean) => {
      const columns = withSource
        ? 'merchant_id, price_source, price_verified_at'
        : 'merchant_id';
      return (await supabase
        .from('merchant_products')
        .select(columns)
        .eq('product_id', productId)
        .is('deleted_at', null)
        .order('price', { ascending: true })
        .limit(50)) as unknown as {
        data: MerchantRow[] | null;
        error: { code?: string; message: string } | null;
      };
    };
    let { data: merchants, error: merchantError } = await runMerchantQuery(true);
    if (merchantError && isUndefinedColumnError(merchantError)) {
      result.columnsMissing = true;
      result.notes.push(
        'Merchant price-source columns do not exist yet (migration 045 not applied), so no listing source can be shown.'
      );
      ({ data: merchants, error: merchantError } = await runMerchantQuery(false));
    }
    if (merchantError) {
      logger.warn('getProductAttribution: merchant listings query failed', {
        error: merchantError.message,
      });
      result.notes.push('Merchant listings could not be read.');
    } else {
      const merchantIds = [...new Set((merchants ?? []).map((r) => r.merchant_id))];
      const names = new Map<string, string>();
      if (merchantIds.length > 0) {
        try {
          const { data: merchantRows } = await supabase
            .from('merchants')
            .select('id, name')
            .in('id', merchantIds);
          for (const row of (merchantRows ?? []) as Array<{ id: string; name: string }>) {
            names.set(row.id, row.name);
          }
        } catch {
          // Names are a label only; a failed lookup leaves nulls.
        }
      }
      result.merchantSources = (merchants ?? []).map((row) => ({
        merchantId: row.merchant_id,
        merchantName: names.get(row.merchant_id) ?? null,
        priceSource: row.price_source ?? null,
        priceVerifiedAt: row.price_verified_at ?? null,
      }));
    }
  } catch {
    result.notes.push('Merchant listings could not be read.');
  }

  // Leg 2 — product_sources rows (pipeline provider fetches).
  // FINAL 100% (W3, F-P1-05) — selects only columns migration
  // 002 actually defines. The previous select asked for
  // `source_url`, which does not exist on this table, so the leg
  // errored on every read and could never return a row.
  try {
    const { data, error } = (await supabase
      .from('product_sources')
      .select('provider_key, retailer_id, external_id, last_fetched_at')
      .eq('product_id', productId)
      .order('last_fetched_at', { ascending: false })
      .limit(50)) as unknown as {
      data: Array<{
        provider_key: string;
        retailer_id: string;
        external_id: string;
        last_fetched_at: string | null;
      }> | null;
      error: { code?: string; message: string } | null;
    };
    if (error) {
      if (isMissingTableError(error)) {
        result.productSourcesMissing = true;
        result.notes.push(
          'The product_sources table could not be read, so no pipeline provider source can be shown.'
        );
      } else {
        logger.warn('getProductAttribution: product_sources query failed', {
          error: error.message,
        });
        result.notes.push('Pipeline provider sources could not be read.');
      }
    } else {
      result.productSources = (data ?? []).map((row) => ({
        providerKey: row.provider_key,
        retailerId: row.retailer_id,
        externalId: row.external_id,
        sourceUrl: null,
        lastFetchedAt: row.last_fetched_at,
      }));
    }
  } catch {
    result.notes.push('Pipeline provider sources could not be read.');
  }

  // Leg 2b — FINAL 100% (W3, F-P1-05): per-observation sources
  // from price_history.source (migration 057). 42703 retry while
  // 057 is unapplied — the leg then contributes nothing, honestly.
  try {
    let { data, error } = (await supabase
      .from('price_history')
      .select('source')
      .eq('product_id', productId)
      .limit(500)) as unknown as {
      data: Array<{ source?: string | null }> | null;
      error: { code?: string; message: string } | null;
    };
    if (error && isUndefinedColumnError(error)) {
      result.notes.push(
        'Price-history sources do not exist yet (migration 057 not applied), so no observation source can be shown.'
      );
      ({ data, error } = { data: [], error: null });
    }
    if (error) {
      logger.warn('getProductAttribution: price_history source query failed', {
        error: error.message,
      });
      result.notes.push('Price-history sources could not be read.');
    } else {
      result.historySources = [
        ...new Set(
          (data ?? [])
            .map((row) => row.source)
            .filter((s): s is string => typeof s === 'string' && s !== '')
        ),
      ].sort();
    }
  } catch {
    result.notes.push('Price-history sources could not be read.');
  }

  // Leg 3 — per-spec attribution counts (058, via the existing reader).
  try {
    const { specs, attributionMissing } = await listProductSpecsWithAttribution(
      supabase,
      productId
    );
    result.specsTotal = specs.length;
    result.specsAttributed = specs.filter((s) => s.source !== null).length;
    result.specsAttributionMissing = attributionMissing;
    if (attributionMissing && specs.length > 0) {
      result.notes.push(
        'Per-spec attribution columns do not exist yet (migration 058 not applied), so spec sources cannot be shown.'
      );
    }
  } catch {
    result.notes.push('Spec attribution could not be read.');
  }

  result.hasAnyAttribution =
    result.merchantSources.some((m) => m.priceSource !== null) ||
    result.productSources.length > 0 ||
    result.specsAttributed > 0 ||
    result.historySources.length > 0;
  result.sources = [
    ...new Set([
      ...result.merchantSources
        .map((m) => m.priceSource)
        .filter((s): s is string => typeof s === 'string' && s !== ''),
      ...result.productSources.map((s) => s.providerKey),
      ...result.historySources,
    ]),
  ].sort();
  result.primarySource = result.sources.length === 1 ? result.sources[0] : null;
  return result;
}

export interface RecordProductAttributionInput {
  productId: string;
  retailerId: string;
  /** External id at the provider — required: the column is NOT NULL, never invent one. */
  externalId: string;
  providerKey: string;
  fetchedAt?: string | null;
}

/**
 * FINAL 100% (W3, F-P1-05) — the WRITE surface for attribution:
 * upsert one product_sources row on (retailer_id, external_id),
 * the same row the pipeline writes internally. Returns false
 * (never throws) when the write fails — the caller keeps its
 * product, only the attribution is missing. A missing/blank
 * externalId is refused: inventing one would fabricate
 * provenance. Manual intake has no external id, so it must NOT
 * call this — its attribution lives on the merchant listing's
 * price_source (045) and the history row's source (057) instead.
 */
export async function recordProductAttribution(
  supabase: AnySupabaseClient,
  input: RecordProductAttributionInput
): Promise<boolean> {
  if (!input.externalId || !input.externalId.trim()) {
    logger.warn('recordProductAttribution: refused — no external id to record');
    return false;
  }
  try {
    const { error } = await supabase.from('product_sources').upsert(
      {
        product_id: input.productId,
        retailer_id: input.retailerId,
        external_id: input.externalId,
        provider_key: input.providerKey,
        last_fetched_at: input.fetchedAt ?? new Date().toISOString(),
      },
      { onConflict: 'retailer_id,external_id' }
    );
    if (error) {
      logger.warn('recordProductAttribution: upsert failed', { error: error.message });
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
