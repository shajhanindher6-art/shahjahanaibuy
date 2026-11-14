/**
 * Saved Calculations data access service (Section 16, #36).
 *
 * A saved calculation is a tool slug + a label + the tool's input
 * params as JSON — the same params the tool's shareable URL
 * carries, so re-opening a saved calculation is a link back to
 * /tools/<tool>?<params>. Only the tools in
 * lib/saved-calculations.ts SAVED_CALCULATION_TOOLS can be saved:
 * the 12 pure-local calculator tools plus the 8 new tools with
 * replayable results (Stage 3, S3-3).
 *
 * Table: `saved_calculations` (migration 043, written NOT applied).
 * Writes go through the AUTHENTICATED server client (the route's
 * createSupabaseServerClient), NOT the service-role client: RLS
 * (auth.uid() = user_id) is the own-only enforcement, and every
 * query below is additionally scoped with .eq('user_id', userId).
 *
 * A missing table (migration 043 unapplied) surfaces as a query
 * error, which the service maps to `null` / `[]` / 'missing-table'
 * — the route turns that into an honest 503 "not available yet",
 * never a fake saved calculation. Nothing here ever invents one.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import {
  buildCalculationShareUrl,
  isSavedCalculationTool,
  type CalculationParams,
  type SavedCalculationTool,
} from '@/lib/saved-calculations';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SavedCalculation {
  id: string;
  userId: string;
  tool: SavedCalculationTool;
  label: string;
  params: CalculationParams;
  shareToken: string;
  /** Re-open link: /tools/<tool>?<params>. */
  shareUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSavedCalculationInput {
  tool: string;
  label: string;
  params: CalculationParams;
}

/** Maximum saved calculations per user (enforced in the API route). */
export const MAX_SAVED_CALCULATIONS = 50;

/** Label: 1–100 chars after trimming. Params JSON: ≤ 4 KB. */
export const MAX_SAVED_CALCULATION_LABEL_LENGTH = 100;
export const MAX_SAVED_CALCULATION_PARAMS_BYTES = 4096;
export const MAX_SAVED_CALCULATION_PARAM_KEYS = 50;

// ---------------------------------------------------------------------------
// Pure validation + helpers (unit-testable, no DB)
// ---------------------------------------------------------------------------

/**
 * Validate a save request. Returns the trimmed label + cleaned
 * params on success, or a human-readable error string. Params must
 * be a plain object of ≤50 string/number/boolean values whose JSON
 * is ≤ 4 KB — a calculation's inputs, never an arbitrary blob.
 */
export function validateSavedCalculationInput(
  input: { tool?: unknown; label?: unknown; params?: unknown } | null | undefined
): { ok: true; tool: SavedCalculationTool; label: string; params: CalculationParams } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'tool, label and params are required' };
  }
  const tool = typeof input.tool === 'string' ? input.tool.trim() : '';
  if (!isSavedCalculationTool(tool)) {
    return { ok: false, error: 'tool must be one of the calculator tools' };
  }
  const label = typeof input.label === 'string' ? input.label.trim() : '';
  if (label.length === 0) {
    return { ok: false, error: 'label is required' };
  }
  if (label.length > MAX_SAVED_CALCULATION_LABEL_LENGTH) {
    return {
      ok: false,
      error: `label must be ${MAX_SAVED_CALCULATION_LABEL_LENGTH} characters or fewer`,
    };
  }
  if (!input.params || typeof input.params !== 'object' || Array.isArray(input.params)) {
    return { ok: false, error: 'params must be an object of calculation inputs' };
  }
  const entries = Object.entries(input.params as Record<string, unknown>);
  if (entries.length === 0) {
    return { ok: false, error: 'params must contain at least one calculation input' };
  }
  if (entries.length > MAX_SAVED_CALCULATION_PARAM_KEYS) {
    return {
      ok: false,
      error: `params must contain at most ${MAX_SAVED_CALCULATION_PARAM_KEYS} inputs`,
    };
  }
  const params: CalculationParams = {};
  for (const [key, value] of entries) {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      return { ok: false, error: 'params values must be strings, numbers or booleans' };
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      return { ok: false, error: 'params values must be finite numbers' };
    }
    params[key] = value;
  }
  if (JSON.stringify(params).length > MAX_SAVED_CALCULATION_PARAMS_BYTES) {
    return {
      ok: false,
      error: `params must be ${MAX_SAVED_CALCULATION_PARAMS_BYTES} bytes or fewer`,
    };
  }
  return { ok: true, tool, label, params };
}

/** Re-open URL for a saved calculation — the tool page replays it. */
export function buildSavedCalculationUrl(tool: string, params: CalculationParams): string {
  return buildCalculationShareUrl(tool, params) ?? `/tools/${tool}`;
}

// ---------------------------------------------------------------------------
// Row → domain mapper
// ---------------------------------------------------------------------------

interface SavedCalculationRow {
  id: string;
  user_id: string;
  tool: string;
  label: string;
  params: CalculationParams | null;
  share_token: string;
  created_at: string;
  updated_at: string;
}

function mapSavedCalculation(row: SavedCalculationRow): SavedCalculation {
  const tool = isSavedCalculationTool(row.tool) ? row.tool : 'emi-calculator';
  const params = row.params && typeof row.params === 'object' ? row.params : {};
  return {
    id: row.id,
    userId: row.user_id,
    tool,
    label: row.label,
    params,
    shareToken: row.share_token,
    shareUrl: buildSavedCalculationUrl(tool, params),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Postgres "relation does not exist" — migration 043 unapplied. */
function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' || /relation .* does not exist/i.test(error.message ?? '');
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

export async function listSavedCalculations(
  supabase: AnySupabaseClient,
  userId: string
): Promise<SavedCalculation[]> {
  try {
    const { data, error } = await supabase
      .from('saved_calculations')
      .select('id, user_id, tool, label, params, share_token, created_at, updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error || !data) {
      if (error && !isMissingTableError(error)) {
        logger.warn('listSavedCalculations: query failed', { error: error.message });
      }
      return [];
    }
    return (data as unknown as SavedCalculationRow[]).map(mapSavedCalculation);
  } catch (err) {
    logger.error('listSavedCalculations: unexpected error', { error: String(err) });
    return [];
  }
}

export type CreateSavedCalculationError = 'missing-table' | 'invalid' | 'failed';

export async function createSavedCalculation(
  supabase: AnySupabaseClient,
  userId: string,
  input: CreateSavedCalculationInput
): Promise<{ savedCalculation: SavedCalculation } | { error: CreateSavedCalculationError }> {
  const validated = validateSavedCalculationInput(input);
  if (!validated.ok) return { error: 'invalid' };
  try {
    const { data, error } = await supabase
      .from('saved_calculations')
      .insert({
        user_id: userId,
        tool: validated.tool,
        label: validated.label,
        params: validated.params,
      })
      .select('id, user_id, tool, label, params, share_token, created_at, updated_at')
      .single();
    if (error || !data) {
      if (error && isMissingTableError(error)) return { error: 'missing-table' };
      if (error) {
        logger.warn('createSavedCalculation: insert failed', { error: error.message });
      }
      return { error: 'failed' };
    }
    return { savedCalculation: mapSavedCalculation(data as unknown as SavedCalculationRow) };
  } catch (err) {
    logger.error('createSavedCalculation: unexpected error', { error: String(err) });
    return { error: 'failed' };
  }
}

export async function deleteSavedCalculation(
  supabase: AnySupabaseClient,
  userId: string,
  id: string
): Promise<boolean> {
  if (typeof id !== 'string' || id.trim() === '') return false;
  try {
    const { data, error } = await supabase
      .from('saved_calculations')
      .delete()
      .eq('user_id', userId)
      .eq('id', id)
      .select('id');
    if (error || !data) {
      if (error && !isMissingTableError(error)) {
        logger.warn('deleteSavedCalculation: delete failed', { error: error.message });
      }
      return false;
    }
    return (data as unknown[]).length > 0;
  } catch (err) {
    logger.error('deleteSavedCalculation: unexpected error', { error: String(err) });
    return false;
  }
}
