/**
 * Section 21–25, Stage D — "last successful update" (audit §1 #61, §12 Stage D).
 *
 * THE GAP: `data_freshness` is "last checked" — it moves on any
 * live check, even one that saved nothing (a check that found no
 * listing, a check whose price was unchanged). Nothing recorded
 * "the last time a real provider response was validated AND
 * saved". A product whose live check keeps finding nothing looks
 * exactly as fresh as one whose price was just saved.
 *
 * THE TIMESTAMP: `products.last_successful_update` (migration
 * 066, written NOT applied — applying it is an owner step).
 * It is set ONLY by `markProductSuccessfullyUpdated`, which
 * callers invoke ONLY after a real provider response was
 * validated and a row was actually written:
 *   - services/ebay-refresh.ts — after a Browse listing is
 *     matched and the merchant_products row is upserted;
 *   - lib/workers/processors.ts (`price.refresh`) — after a
 *     provider fetch is validated and its price_history row is
 *     inserted;
 *   - services/pipeline/ingestion.ts — after a provider-fetched
 *     row's price_history row is inserted.
 * It is deliberately NOT set by services/price-refresh.ts (a DB
 * re-read saves no provider response), by the intake approve
 * (an admin-typed price, not a provider response — its
 * verification stamp is the honest record there), or by any
 * re-check path.
 *
 * BEFORE 066 IS APPLIED the column does not exist: the writer
 * answers 42703 and reports `{ persisted: false, reason:
 * 'column-missing' }` — never a throw, never a fallback stamp
 * onto `data_freshness` (that would re-introduce the confusion
 * this timestamp exists to remove). The reader then DERIVES the
 * value from durable rows that already exist:
 *   - the latest `price_history` row whose source is a live
 *     provider source (`live`, `ebay-browse-api`,
 *     `merchant-feed` — a re-read row carries source NULL and
 *     never counts);
 *   - the latest `merchant_products.last_synced_at` (migration
 *     045, set only by the eBay live-check stamp).
 * The derived value is labelled as derived (`source` says which
 * leg produced it), so the admin surface never presents a
 * derivation as a stored timestamp.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';

/** Migration 066 column on `products` (nullable timestamptz). */
export const LAST_SUCCESSFUL_UPDATE_COLUMN = 'last_successful_update';

/**
 * price_history sources that prove a real provider response was
 * validated and saved. 'seed' and 'manual-intake' are NOT live
 * provider responses; NULL (a DB re-read) never counts.
 */
export const LIVE_PRICE_HISTORY_SOURCES = [
  'live',
  'ebay-browse-api',
  'merchant-feed',
] as const;

export type LastSuccessfulUpdateSource =
  | 'column'
  | 'price-history'
  | 'merchant-sync';

export interface LastSuccessfulUpdate {
  /** ISO timestamp, or null when no successful update is recorded anywhere. */
  at: string | null;
  /** Which durable record produced the value (null when `at` is null). */
  source: LastSuccessfulUpdateSource | null;
  /** True when the 066 column does not exist yet (derived value only). */
  columnMissing: boolean;
}

function isUndefinedColumnError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42703';
}

function isMissingTableError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === '42P01' || code === 'PGRST205';
}

export interface MarkSuccessfulUpdateResult {
  /** True only when the 066 column was actually written. */
  persisted: boolean;
  /** Why a write did not persist ('column-missing' | 'failed'). */
  reason?: 'column-missing' | 'failed';
}

/**
 * Record a successful provider-validated save for one product.
 * Best-effort and never throwing: freshness bookkeeping must
 * never fail the product it records. Call ONLY after the save
 * itself succeeded — never before the provider call, never on a
 * re-read, never on a failed write.
 */
export async function markProductSuccessfullyUpdated(
  supabase: AnySupabaseClient,
  productId: string,
  atIso?: string
): Promise<MarkSuccessfulUpdateResult> {
  const at = atIso ?? new Date().toISOString();
  try {
    const { error } = await supabase
      .from('products')
      .update({ [LAST_SUCCESSFUL_UPDATE_COLUMN]: at })
      .eq('id', productId);
    if (!error) return { persisted: true };
    if (isUndefinedColumnError(error)) {
      return { persisted: false, reason: 'column-missing' };
    }
    logger.warn('markProductSuccessfullyUpdated: write failed', {
      productId,
      error: error.message,
    });
    return { persisted: false, reason: 'failed' };
  } catch (err) {
    logger.warn('markProductSuccessfullyUpdated: write threw', {
      productId,
      error: String(err),
    });
    return { persisted: false, reason: 'failed' };
  }
}

/**
 * Pure resolution: the latest of the candidate timestamps, with
 * the source of the winning leg. `columnValue` is the stored
 * 066 value (null when the column is missing/unset);
 * `liveHistoryAt` is the latest live-source price_history
 * `recorded_at`; `merchantSyncedAt` is the latest
 * merchant_products `last_synced_at`. Invalid timestamps are
 * ignored, never treated as "now".
 */
export function resolveLastSuccessfulUpdate(
  columnValue: string | null | undefined,
  liveHistoryAt: string | null | undefined,
  merchantSyncedAt: string | null | undefined,
  columnMissing: boolean
): LastSuccessfulUpdate {
  const candidates: Array<{ at: string; source: LastSuccessfulUpdateSource }> = [];
  for (const [value, source] of [
    [columnValue, 'column'],
    [liveHistoryAt, 'price-history'],
    [merchantSyncedAt, 'merchant-sync'],
  ] as Array<[string | null | undefined, LastSuccessfulUpdateSource]>) {
    if (!value) continue;
    const time = new Date(value).getTime();
    if (!Number.isFinite(time)) continue;
    candidates.push({ at: new Date(time).toISOString(), source });
  }
  if (candidates.length === 0) {
    return { at: null, source: null, columnMissing };
  }
  candidates.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const winner = candidates[0];
  return { at: winner.at, source: winner.source, columnMissing };
}

/**
 * Read one product's last successful update: the stored 066
 * value when the column exists, otherwise the derived value
 * (see module header). Never throws; a failed read is "unknown"
 * (null), never a fabricated timestamp.
 */
export async function getLastSuccessfulUpdate(
  supabase: AnySupabaseClient,
  productId: string
): Promise<LastSuccessfulUpdate> {
  let columnValue: string | null = null;
  let columnMissing = false;
  try {
    const { data, error } = await supabase
      .from('products')
      .select(`id, ${LAST_SUCCESSFUL_UPDATE_COLUMN}`)
      .eq('id', productId)
      .maybeSingle();
    if (error) {
      if (isUndefinedColumnError(error)) columnMissing = true;
    } else {
      columnValue = (data as { last_successful_update?: string | null } | null)
        ?.last_successful_update ?? null;
    }
  } catch {
    // A failed column read degrades to the derived value below.
  }

  let liveHistoryAt: string | null = null;
  try {
    const { data, error } = await supabase
      .from('price_history')
      .select('recorded_at')
      .eq('product_id', productId)
      .in('source', [...LIVE_PRICE_HISTORY_SOURCES])
      .order('recorded_at', { ascending: false })
      .limit(1);
    if (!error && data && data.length > 0) {
      liveHistoryAt = (data[0] as { recorded_at: string }).recorded_at ?? null;
    }
  } catch {
    // A failed history read degrades to the other legs.
  }

  let merchantSyncedAt: string | null = null;
  try {
    const { data, error } = await supabase
      .from('merchant_products')
      .select('last_synced_at')
      .eq('product_id', productId)
      .not('last_synced_at', 'is', null)
      .order('last_synced_at', { ascending: false })
      .limit(1);
    if (!error && data && data.length > 0) {
      merchantSyncedAt = (data[0] as { last_synced_at: string }).last_synced_at ?? null;
    } else if (error && isMissingTableError(error)) {
      // Merchant table missing entirely — no sync leg exists.
    }
  } catch {
    // A failed merchant read degrades to the other legs.
  }

  return resolveLastSuccessfulUpdate(
    columnValue,
    liveHistoryAt,
    merchantSyncedAt,
    columnMissing
  );
}
