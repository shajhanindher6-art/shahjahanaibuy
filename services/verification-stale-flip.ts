/**
 * Final 100% Product & Real Data Completion — dateless-verified
 * stale flip (F-P1-54, code half).
 *
 * The gap: `verification.stale` can never be non-zero. The
 * existing flip (`flipStaleVerificationStatuses`,
 * services/price-verification.ts) only flips verified rows whose
 * `price_verified_at` is older than STALE_PRICE_DAYS — and a NULL
 * `verified_at` never matches the `.lt('price_verified_at',
 * cutoff)` predicate, while the pure predicate
 * `shouldFlipVerifiedToStale` returns false for a null age. A
 * "verified" stamp with no check date is therefore verified
 * forever. (Worker B, B-2: the intake path can stamp 'verified'
 * with `price_verified_at: null` when the preview time was not
 * carried.)
 *
 * This module is the missing half: a verified row with NO check
 * date flips to 'stale' — "verified, check time not recorded" is
 * not a verification anyone can trust, so it ages out immediately
 * instead of living forever. The dated flip is untouched (W1 owns
 * services/price-verification.ts); this module only adds the
 * dateless case, on BOTH the products rollup and the
 * merchant_products rows, so the two never disagree.
 *
 * Fail-safe, like the dated flip: migration 045 unapplied →
 * `{ columnsMissing: true }`, never a throw — and the flip being
 * unknown is reported as unknown, not as "0 stale". Any other
 * error is reported in `error` and never throws: staleness
 * bookkeeping must never fail a refresh.
 *
 * Wiring: called from `finishRefreshRun`
 * (services/refresh-run.ts) at the end of every recorded refresh
 * run, next to the dated flip's call site in the refresh chain
 * (services/price-refresh.ts:287, W1-owned). When 040 is
 * unapplied there is no run record and `finishRefreshRun` is a
 * no-op — the dateless flip then also needs the one-line call
 * next to the dated flip in services/price-refresh.ts; that line
 * is the W1 merge point, recorded here so it is not lost.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import type { PriceVerificationStatus } from './price-verification';

/**
 * Pure predicate: should this verified price flip to 'stale'
 * because its check date was never recorded?
 * - status 'verified' + verifiedAt null/undefined/blank → true.
 * - anything else (unverified, stale, or verified WITH a date)
 *   → false; dated rows are the dated flip's job, not this one's.
 */
export function shouldFlipDatelessVerifiedToStale(
  status: PriceVerificationStatus | string | null | undefined,
  verifiedAt: string | null | undefined
): boolean {
  if (status !== 'verified') return false;
  return verifiedAt === null || verifiedAt === undefined || verifiedAt.trim() === '';
}

export interface FlipDatelessVerifiedResult {
  flippedProducts: number;
  flippedMerchantRows: number;
  /** True when the 045 columns do not exist yet (42703/PGRST205). */
  columnsMissing: boolean;
  error?: string;
}

/** True when the error means "this column/table does not exist (yet)". */
function isMissingColumnOrTableError(error: { code?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42703' || error.code === '42P01' || error.code === 'PGRST205';
}

/**
 * Flip every verified row with no `price_verified_at` to 'stale'.
 * Best-effort and never throwing. Returns the counts flipped, or
 * `columnsMissing: true` while migration 045 is unapplied.
 */
export async function flipDatelessVerifiedToStale(
  supabase: AnySupabaseClient
): Promise<FlipDatelessVerifiedResult> {
  const result: FlipDatelessVerifiedResult = {
    flippedProducts: 0,
    flippedMerchantRows: 0,
    columnsMissing: false,
  };
  try {
    const { data: products, error: productsError } = await supabase
      .from('products')
      .update({ price_verification_status: 'stale' })
      .eq('price_verification_status', 'verified')
      .is('price_verified_at', null)
      .select('id');
    if (productsError) {
      if (isMissingColumnOrTableError(productsError)) {
        return { ...result, columnsMissing: true };
      }
      logger.warn('flipDatelessVerifiedToStale: products update failed', {
        error: productsError.message,
      });
      return { ...result, error: productsError.message };
    }
    result.flippedProducts = (products ?? []).length;

    const { data: merchantRows, error: merchantError } = await supabase
      .from('merchant_products')
      .update({ price_verification_status: 'stale' })
      .eq('price_verification_status', 'verified')
      .is('price_verified_at', null)
      .is('deleted_at', null)
      .select('id');
    if (merchantError) {
      if (isMissingColumnOrTableError(merchantError)) {
        return { ...result, columnsMissing: true };
      }
      logger.warn('flipDatelessVerifiedToStale: merchant_products update failed', {
        error: merchantError.message,
      });
      return { ...result, error: merchantError.message };
    }
    result.flippedMerchantRows = (merchantRows ?? []).length;
    return result;
  } catch (err) {
    logger.warn('flipDatelessVerifiedToStale: unexpected error', {
      error: String(err),
    });
    return { ...result, error: String(err) };
  }
}
