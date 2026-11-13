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
 *
 * Section 21–25, Stage C (B1 + K12) — the production write path
 * now exists, in this module:
 * - `writeProductSpecs` — intake/pipeline path: validate every
 *   entry against the category template, then insert the valid
 *   ones with per-spec attribution. Any invalid entry blocks the
 *   whole write (nothing half-written, nothing guessed).
 * - `replaceProductSpecs` — admin verify/correct path: delete the
 *   stored rows for the given keys, then insert the corrected
 *   ones. Only the keys the admin touched are replaced; every
 *   other stored spec is left alone.
 * - `deleteProductSpecs` — remove stored specs by key.
 * - `listProductSpecsWithAttribution` — read specs with their
 *   migration-058 attribution, with a 42703 fallback to the
 *   migration-004 columns while 058 is unapplied (attribution
 *   then reads as unattributed, never as an error).
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
): Promise<{
  error: { message: string; code?: string } | null;
  /** True when the insert retried without the 058 columns (unapplied). */
  retriedWithoutAttribution: boolean;
}> {
  if (rows.length === 0) return { error: null, retriedWithoutAttribution: false };
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
    return { error: retry.error, retriedWithoutAttribution: true };
  }
  return { error, retriedWithoutAttribution: false };
}

// ---------------------------------------------------------------------------
// Production spec-write path (Section 21–25, Stage C — B1 + K12)
// ---------------------------------------------------------------------------

export interface WriteProductSpecsInput {
  productId: string;
  category: string | null | undefined;
  entries: SpecEntryInput[];
  attribution?: ProductAttributeAttribution;
}

export interface WriteProductSpecsResult {
  /** Rows inserted (0 when validation failed or nothing to write). */
  inserted: number;
  /** Validation / write errors (empty on success). */
  errors: string[];
  /** True when rows landed without attribution (058 unapplied). */
  attributionMissing: boolean;
}

/**
 * Validate entries against the category template and insert the
 * valid ones with per-spec attribution. An invalid entry blocks
 * the whole write — a half-written spec set would present some
 * keys as verified and silently drop others. An empty entry list
 * is a no-op success (a product with no specs is an honest empty
 * state, not an error). `attributionMissing` is true only when
 * the insert had to retry without the 058 columns.
 */
export async function writeProductSpecs(
  supabase: AnySupabaseClient,
  input: WriteProductSpecsInput
): Promise<WriteProductSpecsResult> {
  const validation = validateSpecEntries(input.category, input.entries);
  if (!validation.valid) {
    return { inserted: 0, errors: validation.errors, attributionMissing: false };
  }
  if (validation.validEntries.length === 0) {
    return { inserted: 0, errors: [], attributionMissing: false };
  }
  const rows: ProductAttributeRow[] = [];
  for (let i = 0; i < validation.validEntries.length; i++) {
    const built = buildProductAttributeRow(
      input.productId,
      input.category,
      validation.validEntries[i],
      input.attribution ?? {},
      i
    );
    if (!built.row) return { inserted: 0, errors: built.errors, attributionMissing: false };
    rows.push(built.row);
  }
  // `attributionMissing` is true exactly when the insert had to
  // retry without the 058 columns (migration unapplied) — the
  // rows landed, the provenance did not.
  const { error, retriedWithoutAttribution } = await insertProductAttributes(supabase, rows);
  if (error) {
    return { inserted: 0, errors: [error.message], attributionMissing: false };
  }
  return { inserted: rows.length, errors: [], attributionMissing: retriedWithoutAttribution };
}

export interface ReplaceProductSpecsResult extends WriteProductSpecsResult {
  /** Keys whose stored rows were replaced (0 when nothing stored). */
  replacedKeys: string[];
}

/**
 * Admin verify/correct path: replace the stored rows for the
 * given keys with the corrected entries, leaving every other
 * stored spec untouched. Validation runs first — an invalid
 * entry replaces nothing. A key with an empty value list entry
 * is not a delete: use `deleteProductSpecs` to remove a spec.
 * The delete is best-effort on a missing table/column (the
 * table exists since migration 004; a delete error is reported,
 * never swallowed, and blocks the insert for those keys).
 */
export async function replaceProductSpecs(
  supabase: AnySupabaseClient,
  input: WriteProductSpecsInput
): Promise<ReplaceProductSpecsResult> {
  const validation = validateSpecEntries(input.category, input.entries);
  if (!validation.valid) {
    return { inserted: 0, errors: validation.errors, attributionMissing: false, replacedKeys: [] };
  }
  const keys = validation.validEntries.map((entry) => entry.key);
  if (keys.length === 0) {
    return { inserted: 0, errors: [], attributionMissing: false, replacedKeys: [] };
  }
  const { error: deleteError } = (await supabase
    .from('product_attributes')
    .delete()
    .eq('product_id', input.productId)
    .in('key', keys)) as {
    error: { message: string; code?: string } | null;
  };
  if (deleteError) {
    return {
      inserted: 0,
      errors: [`Could not remove the stored specs for ${keys.join(', ')}: ${deleteError.message}`],
      attributionMissing: false,
      replacedKeys: [],
    };
  }
  const written = await writeProductSpecs(supabase, input);
  return { ...written, replacedKeys: written.inserted > 0 ? keys : [] };
}

/**
 * Remove stored specs by key. Returns the removed keys; a delete
 * error is reported, never swallowed.
 */
export async function deleteProductSpecs(
  supabase: AnySupabaseClient,
  productId: string,
  keys: string[]
): Promise<{ removedKeys: string[]; error: string | null }> {
  const cleanKeys = [...new Set(keys.map((k) => k.trim().toLowerCase()).filter(Boolean))];
  if (cleanKeys.length === 0) return { removedKeys: [], error: null };
  const { error } = (await supabase
    .from('product_attributes')
    .delete()
    .eq('product_id', productId)
    .in('key', cleanKeys)) as {
    error: { message: string; code?: string } | null;
  };
  if (error) return { removedKeys: [], error: error.message };
  return { removedKeys: cleanKeys, error: null };
}

/** One stored spec with its per-spec attribution (058, nullable). */
export interface StoredProductSpec {
  id: string | null;
  productId: string;
  key: string;
  value: string;
  unit: string | null;
  source: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  sortOrder: number;
}

export interface ListStoredSpecsResult {
  specs: StoredProductSpec[];
  /** True when the 058 columns are missing (legacy read ran). */
  attributionMissing: boolean;
  error?: string;
}

/**
 * Read a product's specs with attribution. Tries the 058
 * columns first; on 42703 retries with the 004 columns and
 * reports `attributionMissing: true` — the specs are real, the
 * provenance is simply not stored yet. Never throws.
 */
export async function listProductSpecsWithAttribution(
  supabase: AnySupabaseClient,
  productId: string
): Promise<ListStoredSpecsResult> {
  const mapRow = (row: Record<string, unknown>, attribution: boolean): StoredProductSpec => ({
    id: typeof row.id === 'string' ? row.id : null,
    productId: String(row.product_id),
    key: String(row.key),
    value: String(row.value),
    unit: (row.unit as string | null) ?? null,
    source: attribution ? ((row.source as string | null) ?? null) : null,
    verifiedAt: attribution ? ((row.verified_at as string | null) ?? null) : null,
    verifiedBy: attribution ? ((row.verified_by as string | null) ?? null) : null,
    sortOrder: typeof row.sort_order === 'number' ? row.sort_order : 0,
  });
  const runQuery = async (withAttribution: boolean) => {
    const columns = withAttribution
      ? 'id, product_id, key, value, unit, source, verified_at, verified_by, sort_order'
      : 'id, product_id, key, value, unit, sort_order';
    return (await supabase
      .from('product_attributes')
      .select(columns)
      .eq('product_id', productId)
      .order('sort_order', { ascending: true })) as unknown as {
      data: Record<string, unknown>[] | null;
      error: { code?: string; message: string } | null;
    };
  };
  try {
    let { data, error } = await runQuery(true);
    let attributionMissing = false;
    if (error && isUndefinedColumnError(error)) {
      attributionMissing = true;
      ({ data, error } = await runQuery(false));
    }
    if (error) {
      return { specs: [], attributionMissing, error: error.message };
    }
    return {
      specs: (data ?? []).map((row) => mapRow(row, !attributionMissing)),
      attributionMissing,
    };
  } catch (err) {
    return { specs: [], attributionMissing: false, error: String(err) };
  }
}
