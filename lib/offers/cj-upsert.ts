/**
 * CJ Affiliate merchant offers — shared upsert helper.
 *
 * One 500-row batch at a time into public.merchant_offers, on
 * conflict (network, advertiser_id, external_product_id).
 * Used by BOTH import paths (CSV feed and GraphQL Product Search)
 * so the two never drift apart. Callers own the stats and the
 * dry-run decision — this helper only performs the upsert.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MerchantOfferRow } from '@/lib/offers/types';

export interface UpsertResult {
  upserted: number;
  /** Error message when the upsert failed, otherwise null. */
  error: string | null;
}

export async function upsertMerchantOffers(
  supabase: SupabaseClient,
  rows: MerchantOfferRow[],
): Promise<UpsertResult> {
  if (rows.length === 0) return { upserted: 0, error: null };
  const { error } = await supabase
    .from('merchant_offers')
    .upsert(rows, { onConflict: 'network,advertiser_id,external_product_id' });
  if (error) return { upserted: 0, error: error.message };
  return { upserted: rows.length, error: null };
}
