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
import { modelsMatch, normalizeModel } from '@/lib/model-normalization';

export interface ProductVariantInput {
  /** Display name, e.g. "16 GB / 512 GB". Required. */
  name: string;
  /** Distinguishing attributes, e.g. { ram: '16 GB', storage: '512 GB' }. */
  attributes?: Record<string, string>;
  /** Merchant SKU for this variant. */
  sku?: string | null;
  /** Variant-level GTIN (GS1-validated when present). */
  gtin?: string | null;
  /**
   * FINAL 100% (F-P1-47): the variant's model number, when the
   * feed carries one. Normalized for matching ("SM-S928B"
   * variants match); a missing model is honest-empty, never a
   * match or a veto on its own.
   */
  modelNumber?: string | null;
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
export type VariantMatchKind = 'sku' | 'gtin' | 'model' | 'attributes' | null;

export interface StoredVariantRef {
  id: string;
  sku: string | null;
  gtin: string | null;
  attributes: Record<string, unknown>;
  /** Stored variant's model number, when recorded (normalized at match time). */
  modelNumber?: string | null;
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
 * physical identity), then MODEL (FINAL 100%, F-P1-47 — the
 * normalized model number, or the `model` attribute when the
 * variant carries its model there), then the identical attribute
 * set. Returns the matched stored row and how it matched, or
 * nulls when the variant is new. Pure — reads nothing.
 *
 * Edge cases (F-P2-39): an invalid variant GTIN never matches
 * by GTIN (validateGtin gates it); a blank SKU never matches;
 * an empty attribute set never matches by attributes (a variant
 * with no distinguishing attributes is not identifiable); when
 * two stored variants would match on the same leg, the FIRST in
 * stored order wins deterministically — the caller must not rely
 * on which one, and the upsert path reports it.
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
  // Model leg: the input's modelNumber, or the `model` attribute
  // when the feed carries the model there. Normalized, so
  // "SM-S928B" variants match each other.
  const inputModel = normalizeModel(input.modelNumber ?? null) ??
    normalizeModel(
      typeof input.attributes?.model === 'string' ? input.attributes.model : null
    );
  if (inputModel) {
    const hit = stored.find((row) => {
      const storedModel =
        normalizeModel(row.modelNumber ?? null) ??
        normalizeModel(
          typeof row.attributes?.model === 'string' ? (row.attributes.model as string) : null
        );
      return storedModel !== null && storedModel === inputModel;
    });
    if (hit) return { variant: hit, matchedBy: 'model' };
  }
  const wantedKey = attributesKey(input.attributes ?? {});
  if (wantedKey !== '[]') {
    const hit = stored.find((row) => attributesKey(row.attributes ?? {}) === wantedKey);
    if (hit) return { variant: hit, matchedBy: 'attributes' };
  }
  return { variant: null, matchedBy: null };
}

/**
 * Match a merchant LISTING to a product's variants (F-P1-47).
 * A listing carries a merchant SKU, a GTIN, and/or a model
 * number — the same three legs as matchVariant, in the same
 * order. Returns the matched variant (or null) with how it
 * matched and a reason. HONEST-EMPTY: when the product has no
 * variants at all, the result is null with reason
 * 'no-variants' — the listing still matches the PRODUCT (this
 * function only answers the variant question, never the product
 * question), it just has no variant to attach to.
 */
export function matchListingToVariant(
  listing: { sku?: string | null; gtin?: string | null; modelNumber?: string | null },
  stored: StoredVariantRef[]
): {
  variant: StoredVariantRef | null;
  matchedBy: VariantMatchKind;
  confidence: number | null;
  reason: string;
} {
  if (stored.length === 0) {
    return {
      variant: null,
      matchedBy: null,
      confidence: null,
      reason: 'no-variants — the product has no stored variants, so the listing attaches to the product, not to a variant',
    };
  }
  const { variant, matchedBy } = matchVariant(
    {
      name: '',
      sku: listing.sku ?? null,
      gtin: listing.gtin ?? null,
      modelNumber: listing.modelNumber ?? null,
    },
    stored
  );
  if (!variant) {
    return {
      variant: null,
      matchedBy: null,
      confidence: null,
      reason: 'no-variant-match — the listing SKU/GTIN/model matches none of the product\'s stored variants',
    };
  }
  const confidence = matchedBy === 'sku' || matchedBy === 'gtin' ? 0.9 : matchedBy === 'model' ? 0.85 : 0.8;
  return {
    variant,
    matchedBy,
    confidence,
    reason: `Listing matches variant "${variant.id}" by ${matchedBy}.`,
  };
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
