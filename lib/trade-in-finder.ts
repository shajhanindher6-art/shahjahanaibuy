/**
 * AI Trade-in & Second-hand Finder (Section 7 item 8).
 *
 * Real trade-in program directory + certified-refurbished guidance,
 * linked to the Resale Predictor ("tumhara purana $X ka hai").
 *
 * HONESTY RULES:
 * - The directory starts EMPTY: no program is ever invented. Until
 *   an admin records a real program (migration for
 *   `trade_in_programs`, written by worker F), the UI shows the
 *   honest "no verified programs recorded yet" state.
 * - No refurbished LISTINGS are invented either: there is no
 *   recorded refurbished inventory, so the page points at the
 *   product's real retailer links and the Resale Predictor instead
 *   of fabricating listings.
 * - Resale values REUSE services/resale-predictor.ts
 *   (predictResaleValue) — the logic is not duplicated here. The
 *   output is always labeled "Simulated — not a resale quote".
 * - Fail-safe: a missing trade_in_programs table/column (42P01 /
 *   42703 / PGRST205) returns an empty directory, never an error
 *   to the UI.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { getCachedPriceHistory } from '@/services/price-history';
import { getProductRecordedOverrides } from '@/services/recorded-overrides';
import {
  predictResaleValue,
  type ResalePrediction,
} from '@/services/resale-predictor';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TradeInProgram {
  id: string;
  name: string;
  retailer: string | null;
  url: string | null;
  category: string | null;
  notes: string | null;
  isVerified: boolean;
  createdAt: string;
}

export interface TradeInDirectory {
  programs: TradeInProgram[];
  /** False when the trade_in_programs table does not exist yet. */
  directoryAvailable: boolean;
  totalPrograms: number;
  verifiedPrograms: number;
}

export interface TradeInSummary {
  totalPrograms: number;
  verifiedPrograms: number;
  /** Resale Predictor output for the linked product, when available. */
  resale: ResalePrediction | null;
  productSlug: string | null;
  /** One-line headline tying the predictor to the directory. */
  headline: string;
}

export const TRADE_IN_EMPTY_MESSAGE =
  'No verified trade-in programs recorded yet. Programs are added by the SmartBuy team only when a real program is confirmed — none are listed until then.';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True for Postgres "table/column does not exist" style failures. */
export function isMissingTableError(error: { code?: string } | null | undefined): boolean {
  return (
    error?.code === '42P01' || error?.code === '42703' || error?.code === 'PGRST205'
  );
}

/** Only http(s) URLs are accepted for program links. Pure. */
export function isValidProgramUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Filter programs to one category (case-insensitive). Pure. */
export function filterProgramsByCategory(
  programs: TradeInProgram[],
  category: string | null | undefined
): TradeInProgram[] {
  if (!category) return programs;
  const wanted = category.trim().toLowerCase();
  return programs.filter((p) => (p.category ?? '').toLowerCase() === wanted);
}

// ---------------------------------------------------------------------------
// Fail-safe directory read
// ---------------------------------------------------------------------------

interface TradeInProgramRow {
  id: string;
  name: string;
  retailer: string | null;
  url: string | null;
  category: string | null;
  notes: string | null;
  is_verified: boolean;
  created_at: string;
}

const TRADE_IN_COLUMNS =
  'id, name, retailer, url, category, notes, is_verified, created_at';

/**
 * Public read of the trade-in program directory. Verified programs
 * first, then the rest, newest first. Returns an empty directory
 * (directoryAvailable: false) when the table has not been created
 * yet — never an error to the UI.
 */
export async function getTradeInPrograms(
  supabase: AnySupabaseClient,
  options: { category?: string } = {}
): Promise<TradeInDirectory> {
  const empty: TradeInDirectory = {
    programs: [],
    directoryAvailable: false,
    totalPrograms: 0,
    verifiedPrograms: 0,
  };
  try {
    let query = supabase
      .from('trade_in_programs')
      .select(TRADE_IN_COLUMNS)
      .order('is_verified', { ascending: false })
      .order('created_at', { ascending: false });
    if (options.category) query = query.eq('category', options.category);

    const { data, error } = await query;
    if (error || !data) {
      if (error && !isMissingTableError(error)) {
        logger.warn('getTradeInPrograms: query failed', { error: error.message });
      }
      return empty;
    }

    const programs = (data as TradeInProgramRow[]).map((row) => ({
      id: row.id,
      name: row.name,
      retailer: row.retailer,
      url: row.url,
      category: row.category,
      notes: row.notes,
      isVerified: row.is_verified,
      createdAt: row.created_at,
    }));

    return {
      programs,
      directoryAvailable: true,
      totalPrograms: programs.length,
      verifiedPrograms: programs.filter((p) => p.isVerified).length,
    };
  } catch (err) {
    logger.error('getTradeInPrograms: unexpected error', { error: String(err) });
    return empty;
  }
}

// ---------------------------------------------------------------------------
// Resale Predictor reuse (no duplicated logic)
// ---------------------------------------------------------------------------

/**
 * Run the shared Resale Predictor for a product: recorded price
 * history + the recorded annual depreciation rate when one exists
 * (Option 19 override). Returns null when there is not enough
 * recorded data — the predictor itself decides that.
 */
export async function getResalePredictionForProduct(
  supabase: AnySupabaseClient,
  productId: string,
  currentPriceUsd: number | null
): Promise<ResalePrediction | null> {
  try {
    const [history, overrides] = await Promise.all([
      getCachedPriceHistory(supabase, productId, { limit: 500 }),
      getProductRecordedOverrides(supabase, productId),
    ]);
    const points = (history?.history ?? []).map((h) => ({
      price: Number(h.price),
      recordedAt: h.recordedAt,
    }));
    const current =
      currentPriceUsd ?? (history?.currentPrice != null ? Number(history.currentPrice) : null);
    return predictResaleValue(points, current, overrides?.annualDepreciationRate ?? null);
  } catch (err) {
    logger.warn('getResalePredictionForProduct: failed', { error: String(err) });
    return null;
  }
}

/** Headline + counts tying the directory to the predictor. Pure. */
export function buildTradeInSummary(
  directory: TradeInDirectory,
  resale: ResalePrediction | null,
  productSlug: string | null
): TradeInSummary {
  let headline: string;
  if (resale && resale.status === 'ok' && resale.projectedValueUsd24 !== null) {
    headline = `Tumhara purana product 24 mahine baad takreeban $${resale.projectedValueUsd24.toFixed(2)} ka ho sakta hai (${resale.retentionPct24}% value retained) — Simulated, not a resale quote.`;
  } else if (resale) {
    headline =
      'Resale value ke liye abhi kaafi recorded price history nahi hai — is liye koi simulated value nahi dikhayi ja rahi.';
  } else {
    headline =
      'Koi product select nahi kiya — product chunein to Resale Predictor aap ko batayega ke aap ka purana product takreeban kitne ka hai (simulated).';
  }

  return {
    totalPrograms: directory.totalPrograms,
    verifiedPrograms: directory.verifiedPrograms,
    resale,
    productSlug,
    headline,
  };
}
