/**
 * Section 21–25, Stage C (B4) — variant support in ingestion.
 *
 * Variants are 0 rows live and no ingestion path knew about them:
 * a feed row for "MacBook Air 13 — 16GB / 512GB" had nowhere to
 * go except a second product row. This module is the code path:
 *
 * - `ProductVariantInput` — one variant as a provider feed (or an
 *   admin) supplies it: a display name, distinguishing attributes
 *   (e.g. `{ ram: '16 GB', storage: '512 GB' }`), an optional SKU,
 *   an optional GTIN, an optional image, stock + sort order.
 * - Matching, strongest first: exact SKU → exact GTIN → identical
 *   attribute set. A match UPDATES the stored variant (price is
 *   not stored on variants — see below); no match INSERTS.
 * - Variant GTIN is validated with the same GS1 check-digit rule
 *   as a product GTIN (lib/gtin.ts). An invalid variant GTIN is
 *   never stored: the variant is skipped and reported, never
 *   silently stored with a bad identity. A variant without a GTIN
 *   is normal — most listings carry none — and is matched on SKU
 *   or attributes instead.
 * - The `gtin` column on `product_variants` exists only after
 *   migration 056 is applied. Inserts retry without it on 42703,
 *   so a variant write never fails over an unapplied migration —
 *   the GTIN is then simply not stored (reported, not invented).
 *
 * Honest limits, stated plainly: variant data is owner-gated —
 * no provider feed supplies variants today, so `upsertProductVariants`
 * has no production caller yet beyond the pipeline (which calls it
 * only when the feed row carries variants). Variants carry no price
 * of their own in the schema (migration 004 has no price column on
 * `product_variants`); a variant's price is the product's merchant
 * price, and inventing a per-variant price column is out of scope.
 * Nothing here creates a product: variants attach to an existing
 * product id only.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { validateGtin } from '@/lib/gtin';

export interface ProductVariantInput {
  /** Display name, e.g. "16 GB / 512 GB". Required. */
  name: string;
  /** Distinguishing attributes, e.g. { ram: '16 GB', storage: '512 GB' }. */
  attributes?: Record<string, string>;
  /** Merchant SKU for this variant. */
  sku?: string | null;
  /** Variant-level GTIN (GS1-validated when present). */
  gtin?: string | null;
  imageUrl?: string | null;
  inStock?: boolean;
  sortOrder?: number;
}

export interface VariantValidation {
  valid: boolean;
  /** Digits-only GTIN when valid and present, otherwise null. */
  normalizedGtin: string | null;
  errors: string[];
}

/**
 * Validate one variant input. A missing name is an error; a
 * present GTIN must pass the GS1 check digit; everything else is
 * optional and normalized (blank SKU/GTIN → null, never '').
 */
export function validateProductVariant(input: ProductVariantInput): VariantValidation {
  const errors: string[] = [];
  if (!input.name || input.name.trim() === '') {
    errors.push('Variant name is required');
  }
  let normalizedGtin: string | null = null;
  const rawGtin = input.gtin?.trim() ? input.gtin.trim() : null;
  if (rawGtin) {
    const check = validateGtin(rawGtin);
    if (!check.valid) {
      errors.push(`Variant GTIN is invalid: ${check.reason ?? 'invalid GTIN'}`);
    } else {
      normalizedGtin = check.normalized;
    }
  }
  return { valid: errors.length === 0, normalizedGtin, errors };
}

/** How a variant was matched to a stored row, if at all. */
export type VariantMatchKind = 'sku' | 'gtin' | 'attributes' | null;

export interface StoredVariantRef {
  id: string;
  sku: string | null;
  gtin: string | null;
  attributes: Record<string, unknown>;
}

function attributesKey(attributes: Record<string, unknown>): string {
  const entries = Object.entries(attributes ?? {})
    .map(([k, v]) => [k.trim().toLowerCase(), String(v).trim().toLowerCase()] as const)
    .filter(([k, v]) => k !== '' && v !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(entries);
}

/**
 * Match one variant input against the stored variants of a
 * product. SKU first (the merchant's own key), then GTIN (the
 * physical identity), then the identical attribute set. Returns
 * the matched stored row and how it matched, or nulls when the
 * variant is new. Pure — reads nothing.
 */
export function matchVariant(
  input: ProductVariantInput,
  stored: StoredVariantRef[]
): { variant: StoredVariantRef | null; matchedBy: VariantMatchKind } {
  const sku = input.sku?.trim() ? input.sku.trim() : null;
  if (sku) {
    const hit = stored.find((row) => row.sku !== null && row.sku.trim() === sku);
    if (hit) return { variant: hit, matchedBy: 'sku' };
  }
  const check = input.gtin?.trim() ? validateGtin(input.gtin) : null;
  const gtin = check?.valid ? check.normalized : null;
  if (gtin) {
    const hit = stored.find(
      (row) => row.gtin !== null && row.gtin.replace(/[\s-]/g, '') === gtin
    );
    if (hit) return { variant: hit, matchedBy: 'gtin' };
  }
  const wantedKey = attributesKey(input.attributes ?? {});
  if (wantedKey !== '[]') {
    const hit = stored.find((row) => attributesKey(row.attributes ?? {}) === wantedKey);
    if (hit) return { variant: hit, matchedBy: 'attributes' };
  }
  return { variant: null, matchedBy: null };
}

function isUndefinedColumnError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42703';
}

export interface UpsertVariantsResult {
  created: number;
  updated: number;
  skipped: number;
  /** True when variant GTINs were dropped (056 unapplied). */
  gtinNotStored: boolean;
  errors: string[];
}

/**
 * Create or update a product's variants. Invalid variants (no
 * name, bad variant GTIN) are skipped and reported — never
 * stored. The stored-variant read is best-effort: a failed read
 * treats every variant as new (an insert may then hit the 056
 * partial UNIQUE index and fail honestly, rather than the whole
 * ingest failing on a read error). Never throws.
 */
export async function upsertProductVariants(
  supabase: AnySupabaseClient,
  productId: string,
  variants: ProductVariantInput[]
): Promise<UpsertVariantsResult> {
  const result: UpsertVariantsResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    gtinNotStored: false,
    errors: [],
  };
  if (variants.length === 0) return result;

  let stored: StoredVariantRef[] = [];
  try {
    const { data, error } = await supabase
      .from('product_variants')
      .select('id, sku, gtin, attributes')
      .eq('product_id', productId)
      .is('deleted_at', null);
    if (!error && data) {
      stored = (data as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id),
        sku: (row.sku as string | null) ?? null,
        gtin: (row.gtin as string | null) ?? null,
        attributes: (row.attributes as Record<string, unknown>) ?? {},
      }));
    } else if (error && !isUndefinedColumnError(error)) {
      logger.warn('upsertProductVariants: stored variants could not be read', {
        error: error.message,
      });
    }
    // A 42703 here means the gtin column (056) is missing — the
    // read retries without it so matching still works on SKU /
    // attributes; the write retry below drops the GTIN the same way.
    if (error && isUndefinedColumnError(error)) {
      const retry = await supabase
        .from('product_variants')
        .select('id, sku, attributes')
        .eq('product_id', productId)
        .is('deleted_at', null);
      if (!retry.error && retry.data) {
        stored = (retry.data as Array<Record<string, unknown>>).map((row) => ({
          id: String(row.id),
          sku: (row.sku as string | null) ?? null,
          gtin: null,
          attributes: (row.attributes as Record<string, unknown>) ?? {},
        }));
      }
    }
  } catch (err) {
    logger.warn('upsertProductVariants: stored variants read failed, treating all as new', {
      error: String(err),
    });
  }

  for (let i = 0; i < variants.length; i++) {
    const input = variants[i];
    const validation = validateProductVariant(input);
    if (!validation.valid) {
      result.skipped += 1;
      result.errors.push(
        `Variant ${i + 1} ("${input.name || 'unnamed'}") skipped: ${validation.errors.join('; ')}`
      );
      continue;
    }
    const { variant: existing, matchedBy } = matchVariant(input, stored);
    const baseRow = {
      product_id: productId,
      name: input.name.trim(),
      sku: input.sku?.trim() ? input.sku.trim() : null,
      attributes: input.attributes ?? {},
      image_url: input.imageUrl?.trim() ? input.imageUrl.trim() : null,
      in_stock: input.inStock ?? true,
      sort_order: input.sortOrder ?? i,
      active: true,
    };
    const rowWithGtin = { ...baseRow, gtin: validation.normalizedGtin };
    try {
      if (existing) {
        const { error } = (await supabase
          .from('product_variants')
          .update(rowWithGtin)
          .eq('id', existing.id)) as {
          error: { code?: string; message: string } | null;
        };
        if (error && isUndefinedColumnError(error)) {
          const retry = (await supabase
            .from('product_variants')
            .update(baseRow)
            .eq('id', existing.id)) as {
            error: { message: string } | null;
          };
          if (retry.error) {
            result.skipped += 1;
            result.errors.push(`Variant "${input.name}" update failed: ${retry.error.message}`);
            continue;
          }
          result.gtinNotStored = true;
        } else if (error) {
          result.skipped += 1;
          result.errors.push(`Variant "${input.name}" update failed: ${error.message}`);
          continue;
        } else if (validation.normalizedGtin) {
          // Update path stored the GTIN only when the column exists;
          // no error means it did.
        }
        result.updated += 1;
        void matchedBy;
      } else {
        const { error } = (await supabase
          .from('product_variants')
          .insert(rowWithGtin)) as {
          error: { code?: string; message: string } | null;
        };
        if (error && isUndefinedColumnError(error)) {
          const retry = (await supabase
            .from('product_variants')
            .insert(baseRow)) as {
            error: { message: string } | null;
          };
          if (retry.error) {
            result.skipped += 1;
            result.errors.push(`Variant "${input.name}" insert failed: ${retry.error.message}`);
            continue;
          }
          result.gtinNotStored = true;
        } else if (error) {
          result.skipped += 1;
          result.errors.push(`Variant "${input.name}" insert failed: ${error.message}`);
          continue;
        }
        result.created += 1;
      }
    } catch (err) {
      result.skipped += 1;
      result.errors.push(`Variant "${input.name}" failed: ${String(err)}`);
    }
  }
  return result;
}
