/**
 * Section 20, §12 #29 — per-spec source attribution writer.
 *
 * `product_attributes` (migration 004) records a spec key/value
 * with no provenance at all: no `source`, no `verified_at`, no
 * `verified_by`. Migration 058 adds those three columns. This
 * module is the only writer that knows about them:
 * `buildProductAttributeRow` validates the entry against the
 * category spec template (lib/spec-templates.ts) and attaches
 * the attribution; `insertProductAttributes` writes rows with a
 * 42703 retry, so it degrades honestly while 058 is unapplied
 * (rows land without attribution, never fail the caller).
 *
 * Attribution rules:
 * - `source` is free text and unknown values are allowed: NULL
 *   means unattributed, `'unknown'` means the provenance was
 *   explicitly not recorded. No CHECK constrains it — a future
 *   source (a new merchant feed, a manufacturer sheet) must not
 *   need a migration to be named.
 * - `verified_at` is set only when the source names a real
 *   provenance (anything other than null / `'unknown'`) and the
 *   caller did not supply one — an unknown-provenance spec is
 *   never stamped "verified at <time>".
 * - `verified_by` is free text (admin user id, admin email, or
 *   `'system'`); it is never a user id looked up from anywhere.
 *
 * No admin UI calls this writer yet (audit §5: "No admin spec
 * verify/correct path") — the builder + tests are the wiring
 * point for that UI, and the intake/spec-write paths use it
 * instead of inserting `product_attributes` rows directly.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import {
  validateSpecEntries,
  type SpecEntryInput,
} from '@/lib/spec-templates';

/** Per-spec attribution (migration 058 columns). */
export interface ProductAttributeAttribution {
  /** Where the value came from, e.g. 'manual-intake', 'ebay-browse-api', 'merchant-feed', 'unknown'. */
  source?: string | null;
  /** ISO timestamp the value was verified, or null. */
  verifiedAt?: string | null;
  /** Who verified it (admin id/email or 'system'), or null. */
  verifiedBy?: string | null;
}

export interface ProductAttributeRow {
  product_id: string;
  key: string;
  value: string;
  unit?: string | null;
  /** Migration 058 attribution (null = unattributed). */
  source?: string | null;
  verified_at?: string | null;
  verified_by?: string | null;
  sort_order?: number;
}

export interface BuiltAttributeRow {
  /** The row to insert, or null when validation failed. */
  row: ProductAttributeRow | null;
  /** Validation errors (empty when the row was built). */
  errors: string[];
}

/**
 * Build one attributed spec row. The entry is validated against
 * the product category's spec template first — an unknown key,
 * an empty value or a disallowed unit is an error, never a
 * stored guess. Attribution is attached as documented above.
 */
export function buildProductAttributeRow(
  productId: string,
  category: string | null | undefined,
  entry: SpecEntryInput,
  attribution: ProductAttributeAttribution = {},
  sortOrder = 0
): BuiltAttributeRow {
  const validation = validateSpecEntries(category, [entry]);
  if (!validation.valid || validation.validEntries.length === 0) {
    return { row: null, errors: validation.errors };
  }
  const valid = validation.validEntries[0];
  const source = attribution.source?.trim() ? attribution.source.trim() : null;
  const verifiedAt =
    source !== null && source !== 'unknown'
      ? (attribution.verifiedAt ?? new Date().toISOString())
      : null;
  return {
    row: {
      product_id: productId,
      key: valid.key,
      value: valid.value,
      ...(valid.unit ? { unit: valid.unit } : {}),
      source,
      verified_at: verifiedAt,
      verified_by: attribution.verifiedBy?.trim() ? attribution.verifiedBy.trim() : null,
      sort_order: sortOrder,
    },
    errors: [],
  };
}

/** PostgREST/Postgres code for "column does not exist". */
function isUndefinedColumnError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42703';
}

/**
 * Insert attributed spec rows. Tries the migration-058 columns
 * first; on 42703 retries with only the migration-004 columns.
 * Returns the first error, or null. Never throws on a missing
 * column — the attribution is best-effort until 058 applies.
 */
export async function insertProductAttributes(
  supabase: AnySupabaseClient,
  rows: ProductAttributeRow[]
): Promise<{ error: { message: string; code?: string } | null }> {
  if (rows.length === 0) return { error: null };
  const { error } = (await supabase.from('product_attributes').insert(rows)) as {
    error: { message: string; code?: string } | null;
  };
  if (error && isUndefinedColumnError(error)) {
    const legacyRows = rows.map((row) => ({
      product_id: row.product_id,
      key: row.key,
      value: row.value,
      ...(row.unit ? { unit: row.unit } : {}),
      sort_order: row.sort_order ?? 0,
    }));
    const retry = (await supabase.from('product_attributes').insert(legacyRows)) as {
      error: { message: string; code?: string } | null;
    };
    return { error: retry.error };
  }
  return { error };
}
