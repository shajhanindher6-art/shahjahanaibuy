/**
 * Section 19, Phase 8 (§12 #14) — durable AI-cache invalidation.
 *
 * Why this file exists: the AI summary and prediction services
 * cache in TWO layers. The in-memory SWR entries
 * (`ai-summary:<id>`, `prediction:<id>`) are cleared by
 * `invalidateAiCachesForProduct` in `lib/cache/index.ts` — but the
 * fetchers behind them read DURABLE rows (`ai_summaries` /
 * `ai_predictions`, up to 7-day `expires_at`). Clearing only the
 * memory key would re-read the same stale row on the next request
 * and re-cache it, so the invalidation would be a no-op. This
 * module deletes those stored rows for one product.
 *
 * What is deleted: derived AI rows ONLY — `ai_summaries` and
 * `ai_predictions` rows for the product. Both are regenerated on
 * demand from the recorded product + price-history rows by
 * `getAISummary` / `predictPriceDrop`, so deleting them loses no
 * source data; the next read recomputes from the fresh price.
 * No other table is touched, and no product/price row is ever
 * deleted here.
 *
 * Failure mode: best-effort, never throws. A missing table (the
 * migrations that create these tables are owner-applied) or an
 * RLS denial is logged and reported in the returned `errors` —
 * the refresh that called this must never fail because a cache
 * row could not be deleted.
 *
 * Callers (the refresh paths, where a new price point is
 * recorded): `services/price-refresh.ts` (`refreshTrackedPrices`)
 * and the `price.refresh` processor in `lib/workers/processors.ts`.
 * Product updates go through `invalidateProductCaches` in
 * `lib/cache/index.ts` (memory only — an intake-approved product
 * has no stored AI rows yet).
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { invalidateAiCachesForProduct } from './index';

export interface StoredAiInvalidationResult {
  /** True when the ai_summaries delete ran without error. */
  summariesCleared: boolean;
  /** True when the ai_predictions delete ran without error. */
  predictionsCleared: boolean;
  /** One entry per failed table (empty when both succeeded). */
  errors: string[];
}

/**
 * Delete the stored AI rows for one product (best-effort, never
 * throws). Returns which tables were cleared and any errors.
 */
export async function invalidateStoredAiResults(
  supabase: AnySupabaseClient,
  productId: string
): Promise<StoredAiInvalidationResult> {
  const errors: string[] = [];
  let summariesCleared = false;
  let predictionsCleared = false;

  try {
    const { error } = await supabase
      .from('ai_summaries')
      .delete()
      .eq('product_id', productId);
    if (error) {
      errors.push(`ai_summaries: ${error.message}`);
    } else {
      summariesCleared = true;
    }
  } catch (err) {
    errors.push(`ai_summaries: ${String(err)}`);
  }

  try {
    const { error } = await supabase
      .from('ai_predictions')
      .delete()
      .eq('product_id', productId);
    if (error) {
      errors.push(`ai_predictions: ${error.message}`);
    } else {
      predictionsCleared = true;
    }
  } catch (err) {
    errors.push(`ai_predictions: ${String(err)}`);
  }

  if (errors.length > 0) {
    logger.warn('invalidateStoredAiResults: stored AI rows not fully cleared', {
      productId,
      errors,
    });
  }

  return { summariesCleared, predictionsCleared, errors };
}

/**
 * Full AI invalidation for one product: the in-memory SWR entries
 * (ai-summary, prediction, comparisons containing it) AND the
 * stored `ai_summaries` / `ai_predictions` rows. Call this after a
 * new price point is recorded for the product. Best-effort — never
 * throws, so wrap it in try/catch at the call site anyway per the
 * refresh convention ("bookkeeping must never fail the product").
 */
export async function invalidateAiForProduct(
  supabase: AnySupabaseClient,
  productId: string
): Promise<StoredAiInvalidationResult> {
  invalidateAiCachesForProduct(productId);
  return invalidateStoredAiResults(supabase, productId);
}
