/**
 * Final 100% Product & Real Data Completion — merchant currency
 * handling (F-P1-58, code half).
 *
 * The gap: `currency_id` is NULL on all 20 live merchant rows
 * and USD is assumed everywhere a price is displayed, while no
 * refresh path FX-converts anything (by design — converting a
 * recorded EUR price to USD with a static rate would invent a
 * USD price nobody observed; see services/refresh-currency.ts).
 *
 * What already persists a currency (verified before writing
 * this module — not rebuilt here):
 * - CSV/eBay intake approve writes `currency_id` from the
 *   known-currencies map
 *   (app/api/v1/admin/intake/route.ts `mpBase`);
 * - the eBay refresh leg writes `currency_id` on its merchant
 *   upsert (services/ebay-refresh.ts `writeEbayMerchantRow`
 *   patch) and skips unknown-currency listings instead of
 *   recording them as USD.
 * What this module adds, as the remaining code half:
 * - `getMerchantCurrencies` — the stored currency per product,
 *   resolved from `merchant_products.currency_id` through the
 *   `currencies` table and rendered as the stored code. A NULL
 *   `currency_id` resolves to `code: null, assumedUsd: true`:
 *   the price is shown with its stored code when one exists,
 *   and labelled "currency not recorded — USD assumed in run
 *   counts, not stored" when it does not. Never a silent USD.
 * - `persistMerchantCurrencyCode` — the writer the refresh leg
 *   needs: store a validated 3-letter code's `currency_id` on a
 *   merchant row. The refresh leg itself
 *   (services/price-refresh.ts, W1-owned) only counts assumed
 *   USD today; this helper is the persistence it can call, with
 *   tests pinning that it stores the code verbatim and never
 *   converts.
 * - `insertPriceHistoryRow` (services/price-history-quality.ts)
 *   now also writes migration 060's `currency_code` column when
 *   it exists, with the same tiered 42703 retry as the 057
 *   columns — the recorded currency travels with the history
 *   row instead of living only in the legacy `currency` column.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import {
  normalizeCurrencyCode,
  resolveListingCurrency,
} from './refresh-currency';

export interface MerchantCurrency {
  productId: string;
  merchantId: string;
  /** Stored 3-letter code, or null when no currency was recorded. */
  code: string | null;
  /** True when the row carried no currency_id (USD assumed, not stored). */
  assumedUsd: boolean;
  /** True when the row carried a currency_id no `currencies` row explains. */
  unknownCurrencyId: boolean;
}

export interface MerchantCurrenciesResult {
  /** Per-product stored currencies (cheapest listing first per product). */
  byProduct: Map<string, MerchantCurrency[]>;
  /** Distinct stored codes across the products read (nulls excluded). */
  distinctCodes: string[];
  /** True when the currencies table could not be read. */
  currenciesMissing: boolean;
  notes: string[];
}

/**
 * Read the stored currency for a set of products. Never throws;
 * a failed read yields empty lists plus a note, never an assumed
 * USD presented as stored.
 */
export async function getMerchantCurrencies(
  supabase: AnySupabaseClient,
  productIds: string[]
): Promise<MerchantCurrenciesResult> {
  const byProduct = new Map<string, MerchantCurrency[]>();
  for (const id of productIds) byProduct.set(id, []);
  const result: MerchantCurrenciesResult = {
    byProduct,
    distinctCodes: [],
    currenciesMissing: false,
    notes: [],
  };
  if (productIds.length === 0) return result;

  const codeById = new Map<string, string>();
  try {
    const { data, error } = await supabase
      .from('currencies')
      .select('id, code')
      .limit(200);
    if (error || !data) {
      result.currenciesMissing = true;
      result.notes.push('The currencies table could not be read, so stored currency codes cannot be resolved.');
    } else {
      for (const row of (data ?? []) as Array<{ id: string; code: string }>) {
        const code = normalizeCurrencyCode(row.code);
        if (code) codeById.set(row.id, code);
      }
    }
  } catch {
    result.currenciesMissing = true;
    result.notes.push('The currencies table could not be read, so stored currency codes cannot be resolved.');
  }

  try {
    type MerchantRow = { product_id: string; merchant_id: string; currency_id?: string | null };
    const runQuery = async (withCurrency: boolean) => {
      const columns = withCurrency
        ? 'product_id, merchant_id, currency_id'
        : 'product_id, merchant_id';
      return (await supabase
        .from('merchant_products')
        .select(columns)
        .in('product_id', productIds)
        .is('deleted_at', null)
        .order('price', { ascending: true })
        .limit(5000)) as unknown as {
        data: MerchantRow[] | null;
        error: { code?: string; message: string } | null;
      };
    };
    let { data: merchants, error } = await runQuery(true);
    if (error && (error as { code?: string }).code === '42703') {
      // A merchant_products table predating currency_id: every row
      // is then currency-unrecorded, never silently USD.
      ({ data: merchants, error } = await runQuery(false));
    }
    if (error) {
      logger.warn('getMerchantCurrencies: merchant listings query failed', {
        error: error.message,
      });
      result.notes.push('Merchant listings could not be read.');
      return result;
    }
    const codes = new Set<string>();
    for (const row of merchants ?? []) {
      const resolved = resolveListingCurrency(row.currency_id ?? null, codeById);
      const entry: MerchantCurrency = {
        productId: row.product_id,
        merchantId: row.merchant_id,
        code: resolved.assumedUsd ? null : resolved.code,
        assumedUsd: resolved.assumedUsd,
        unknownCurrencyId: resolved.unknownCurrencyId,
      };
      byProduct.get(row.product_id)?.push(entry);
      if (entry.code) codes.add(entry.code);
    }
    result.distinctCodes = [...codes].sort();
    return result;
  } catch (err) {
    logger.warn('getMerchantCurrencies: unexpected error', { error: String(err) });
    result.notes.push('Merchant listings could not be read.');
    return result;
  }
}

export type PersistMerchantCurrencyOutcome =
  | 'updated'
  | 'unknown-currency'
  | 'missing-column'
  | 'missing-table'
  | 'failed';

/**
 * Store a validated currency code on one merchant row, by
 * resolving the code to its `currencies` id and writing
 * `currency_id`. Never FX-converts: the code is stored verbatim.
 * Returns 'unknown-currency' when no `currencies` row carries
 * the code (the caller must then skip or count, never record
 * USD in its place). Never throws.
 */
export async function persistMerchantCurrencyCode(
  supabase: AnySupabaseClient,
  merchantProductId: string,
  code: string
): Promise<PersistMerchantCurrencyOutcome> {
  const normalized = normalizeCurrencyCode(code);
  if (!normalized) return 'unknown-currency';
  try {
    const { data: currencyRows, error: currencyError } = (await supabase
      .from('currencies')
      .select('id')
      .eq('code', normalized)
      .limit(1)) as unknown as {
      data: Array<{ id: string }> | null;
      error: { code?: string; message: string } | null;
    };
    if (currencyError) {
      if (currencyError.code === '42P01' || currencyError.code === 'PGRST205') {
        return 'missing-table';
      }
      logger.warn('persistMerchantCurrencyCode: currencies lookup failed', {
        error: currencyError.message,
      });
      return 'failed';
    }
    const currencyId = (currencyRows ?? [])[0]?.id;
    if (!currencyId) return 'unknown-currency';
    const { error: updateError } = (await supabase
      .from('merchant_products')
      .update({ currency_id: currencyId })
      .eq('id', merchantProductId)) as unknown as {
      error: { code?: string; message: string } | null;
    };
    if (updateError) {
      if (updateError.code === '42703') return 'missing-column';
      if (updateError.code === '42P01' || updateError.code === 'PGRST205') {
        return 'missing-table';
      }
      logger.warn('persistMerchantCurrencyCode: update failed', {
        error: updateError.message,
      });
      return 'failed';
    }
    return 'updated';
  } catch (err) {
    logger.warn('persistMerchantCurrencyCode: unexpected error', { error: String(err) });
    return 'failed';
  }
}
