/**
 * FINAL 100% Product & Real Data Completion — Worker W3 (F-P1-35).
 *
 * Manual/CSV intake prices never entered `price_history`: the
 * intake approve path never called `recordPriceHistory` (its only
 * caller was services/pipeline/ingestion.ts), so an admin-approved
 * price was visible in the catalog but left no history point — the
 * history understated what the catalog knew.
 *
 * This module is the approve path's history writer. It resolves
 * the intake merchant (`merchants` table) to the history retailer
 * (`retailers` table — the two tables are separate; intake
 * resolves against `merchants`, history rows reference
 * `retailers`, matched by slug), dedupes against the latest
 * recorded point (an unchanged re-approve records nothing), and
 * inserts through the quality writer with source attribution.
 *
 * Provenance: source is the intake source ('manual-intake' for
 * CSV batches, 'ebay-browse-api' for eBay preview batches);
 * observed_at is the preview fetch time for eBay rows, and
 * explicit null for manual rows — a typed-in price was never
 * observed, and stamping "now" would invent an observation time.
 * Availability is 'unknown' unless the source supplied one
 * (see services/intake-evidence.ts — neither CSV nor eBay
 * preview carries availability today).
 *
 * Best-effort by design: a failed/skipped history write never
 * fails the approve — the product and listing are already in.
 * The caller records the returned reason in the response/audit
 * log so a missing history point is visible, never silent.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import {
  assessPriceChange,
  insertPriceHistoryRow,
  isDuplicatePricePoint,
  type PriceHistorySource,
} from '@/services/price-history-quality';
import { resolveIntakeAvailability } from '@/services/intake-evidence';

export type IntakePriceHistorySource = 'manual-intake' | 'ebay-browse-api';

export interface RecordIntakePriceHistoryInput {
  productId: string;
  /** merchants.id of the approved listing. */
  merchantId: string;
  price: number;
  /** 3-letter currency code for the history row (resolved by the caller). */
  currencyCode: string;
  source: IntakePriceHistorySource;
  /**
   * When the price was observed (eBay preview fetch time), or
   * null when it was never observed (manual intake). Explicit
   * null is preserved as NULL — never replaced with "now".
   */
  observedAt?: string | null;
  /** Availability as supplied by the source; 'unknown' when not supplied. */
  availability?: string | null;
}

export interface RecordIntakePriceHistoryResult {
  recorded: boolean;
  /** Why nothing was recorded (absent when recorded). */
  reason?:
    | 'invalid-price'
    | 'no-merchant-row'
    | 'no-retailer-row'
    | 'unchanged'
    | 'insert-failed';
  suspicious: boolean;
}

async function lookupSlug(
  supabase: AnySupabaseClient,
  table: 'merchants' | 'retailers',
  id: string
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from(table)
      .select('slug')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return (data as { slug: string }).slug;
  } catch {
    return null;
  }
}

/** Resolve a merchants.id to the matching retailers.id (by slug). */
export async function resolveIntakeRetailerId(
  supabase: AnySupabaseClient,
  merchantId: string
): Promise<string | null> {
  const slug = await lookupSlug(supabase, 'merchants', merchantId);
  if (!slug) return null;
  try {
    const { data, error } = await supabase
      .from('retailers')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();
    if (error || !data) return null;
    return (data as { id: string }).id;
  } catch {
    return null;
  }
}

export async function recordIntakePriceHistory(
  supabase: AnySupabaseClient,
  input: RecordIntakePriceHistoryInput
): Promise<RecordIntakePriceHistoryResult> {
  if (!Number.isFinite(input.price) || input.price <= 0) {
    return { recorded: false, reason: 'invalid-price', suspicious: false };
  }
  const availability = resolveIntakeAvailability(input.availability);
  const retailerId = await resolveIntakeRetailerId(supabase, input.merchantId);
  if (!retailerId) {
    logger.warn('Intake history: no retailers row for merchant', {
      productId: input.productId,
      merchantId: input.merchantId,
    });
    return { recorded: false, reason: 'no-retailer-row', suspicious: false };
  }

  // Dedupe against the latest recorded point (same rule as the
  // refresh writer and ingestion): an unchanged price records
  // nothing, even on a re-approve.
  let history: Array<{ price: number; recordedAt: string }> = [];
  let latestAvailability: string | null = null;
  try {
    const { data } = await supabase
      .from('price_history')
      .select('price, availability, recorded_at')
      .eq('product_id', input.productId)
      .eq('retailer_id', retailerId)
      .order('recorded_at', { ascending: false })
      .limit(30);
    const rows = (data ?? []) as Array<{
      price: number | string;
      availability?: string | null;
      recorded_at: string;
    }>;
    latestAvailability = rows.length > 0 ? (rows[0].availability ?? null) : null;
    history = rows
      .map((row) => ({
        price: parseFloat(String(row.price)),
        recordedAt: row.recorded_at,
      }))
      .filter((p) => Number.isFinite(p.price));
  } catch {
    history = [];
  }
  if (
    isDuplicatePricePoint(
      history.length > 0
        ? { price: history[0].price, availability: latestAvailability }
        : null,
      input.price,
      availability
    )
  ) {
    return { recorded: false, reason: 'unchanged', suspicious: false };
  }

  const nowIso = new Date().toISOString();
  const assessment = assessPriceChange(history, input.price, nowIso);
  if (assessment.suspicious) {
    logger.warn('Intake history: suspicious price change flagged', {
      productId: input.productId,
      reasons: assessment.reasons,
    });
  }
  const source: PriceHistorySource = input.source;
  const { error } = await insertPriceHistoryRow(supabase, {
    product_id: input.productId,
    retailer_id: retailerId,
    price: input.price,
    currency: input.currencyCode,
    availability,
    url: null,
    recorded_at: nowIso,
    source,
    observed_at: input.observedAt === undefined ? null : input.observedAt,
    suspicious_change: assessment.suspicious,
  });
  if (error) {
    logger.warn('Intake history: insert failed', {
      productId: input.productId,
      error: error.message,
    });
    return { recorded: false, reason: 'insert-failed', suspicious: assessment.suspicious };
  }
  return { recorded: true, suspicious: assessment.suspicious };
}
