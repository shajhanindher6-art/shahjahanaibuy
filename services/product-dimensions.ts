/**
 * Product dimensions / 3D model / authenticity / supply-chain readers
 * (Section 6, items 4 + 5 + 10 + 11).
 *
 * Deterministic, no LLM, no fetch, no scraping. Pure reads of values
 * recorded per product in the `products` table (migration 033).
 * Nothing is invented: a product with no recorded dimensions gets NO
 * diagram, a product with no recorded model URL gets NO 3D viewer,
 * and authenticity / supply-chain fields stay null until an admin
 * records real values from the brand/retailer/manufacturer's own
 * published data.
 *
 * MODEL URL RULES (validated here, never trusted raw):
 * - Must be an https: URL. http: and protocol-relative URLs are
 *   rejected — a 3D model file is executable-ish content and must
 *   never be loaded over plaintext.
 * - Pathname must end in .glb or .gltf (case-insensitive).
 *   Anything else (.usdz, .obj, .png, a page URL) is rejected.
 *   A query string is allowed; the extension check runs on the
 *   pathname, so `model.glb?v=2` is fine.
 *
 * Fail-safe pattern (same as getProductPhysical / getProductRepairability):
 * every reader returns nulls on a query error (migration 033 not run
 * yet), on RLS blocking the read, or on any exception — never throws —
 * so the product page renders honest empty states instead of breaking.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';

/** Recorded dimensions in cm; each null when not recorded. */
export interface ProductDimensionsData {
  /** Length in cm, or null when not recorded. */
  lengthCm: number | null;
  /** Width in cm, or null when not recorded. */
  widthCm: number | null;
  /** Height in cm, or null when not recorded. */
  heightCm: number | null;
}

/** Recorded authenticity info; null (whole object) when unrecorded. */
export interface ProductAuthenticityData {
  /** How authenticity is verified (admin-recorded free text), or null. */
  method: string | null;
  /** Source URL for the verification method, or null. */
  url: string | null;
  /** ISO timestamp of the last verification, or null. */
  verifiedAt: string | null;
}

/** Recorded supply-chain info; null (whole object) when unrecorded. */
export interface ProductSupplyChainData {
  /** Country of origin, or null when not recorded. */
  countryOfOrigin: string | null;
  /** Manufacturer name, or null when not recorded. */
  manufacturerName: string | null;
  /** Recorded certifications (never invented); [] when none recorded. */
  certifications: string[];
  /** Admin-recorded supply-chain note, or null. */
  note: string | null;
  /** Source URL for the supply-chain note, or null. */
  sourceUrl: string | null;
}

/** Model-file extensions the viewer can load. */
export const MODEL_URL_EXTENSIONS = ['.glb', '.gltf'] as const;

/**
 * A recorded dimension must be a finite number greater than 0
 * (the migration CHECK enforces the same bound in the DB).
 * Accepts PostgREST numeric values, which may arrive as strings.
 */
export function sanitizePositiveDimension(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : (value as number);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Non-empty trimmed text, or null. Non-strings are null. */
export function sanitizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * An https: URL, or null. Used for authenticity / supply-chain
 * source URLs — http: links are never surfaced as verification
 * sources.
 */
export function sanitizeHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:') return null;
    return trimmed;
  } catch {
    return null;
  }
}

/**
 * Validate a recorded 3D model URL: https: + a .glb/.gltf pathname.
 * Returns the trimmed URL when valid, else null. Never throws.
 */
export function sanitizeModelUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:') return null;
    const pathname = url.pathname.toLowerCase();
    if (!MODEL_URL_EXTENSIONS.some((ext) => pathname.endsWith(ext))) return null;
    return trimmed;
  } catch {
    return null;
  }
}

/**
 * Clean a recorded certifications array: trim, drop empties,
 * dedupe (first occurrence wins). Anything non-array is [].
 * No certification is ever invented here.
 */
export function sanitizeCertifications(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Fail-safe read of one product's recorded dimensions (migration 033).
 * Returns all nulls when the columns do not exist yet, when RLS
 * blocks the read, or on any error. Never throws.
 */
export async function getProductDimensions(
  supabase: AnySupabaseClient,
  productId: string
): Promise<ProductDimensionsData> {
  const empty: ProductDimensionsData = { lengthCm: null, widthCm: null, heightCm: null };
  try {
    const { data, error } = await supabase
      .from('products')
      .select('length_cm, width_cm, height_cm')
      .eq('id', productId)
      .maybeSingle();
    if (error || !data) {
      if (error) {
        logger.warn('getProductDimensions: query failed (033 may not be run)', {
          error: error.message,
        });
      }
      return empty;
    }
    const row = data as Record<string, unknown>;
    return {
      lengthCm: sanitizePositiveDimension(row.length_cm),
      widthCm: sanitizePositiveDimension(row.width_cm),
      heightCm: sanitizePositiveDimension(row.height_cm),
    };
  } catch (err) {
    logger.warn('getProductDimensions: unexpected error', { error: String(err) });
    return empty;
  }
}

/**
 * Fail-safe read of one product's recorded 3D model URL (migration 033).
 * Returns null when unrecorded, invalid (non-https or wrong extension),
 * or on any error. Never throws.
 */
export async function getProductModelUrl(
  supabase: AnySupabaseClient,
  productId: string
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('model_url')
      .eq('id', productId)
      .maybeSingle();
    if (error || !data) {
      if (error) {
        logger.warn('getProductModelUrl: query failed (033 may not be run)', {
          error: error.message,
        });
      }
      return null;
    }
    const row = data as Record<string, unknown>;
    return sanitizeModelUrl(row.model_url);
  } catch (err) {
    logger.warn('getProductModelUrl: unexpected error', { error: String(err) });
    return null;
  }
}

/**
 * Fail-safe read of one product's recorded authenticity info
 * (migration 033). Returns null when nothing is recorded, when the
 * columns do not exist yet, when RLS blocks the read, or on any
 * error. Never throws. No verification is ever claimed here.
 */
export async function getProductAuthenticity(
  supabase: AnySupabaseClient,
  productId: string
): Promise<ProductAuthenticityData | null> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('authenticity_method, authenticity_url, authenticity_verified_at')
      .eq('id', productId)
      .maybeSingle();
    if (error || !data) {
      if (error) {
        logger.warn('getProductAuthenticity: query failed (033 may not be run)', {
          error: error.message,
        });
      }
      return null;
    }
    const row = data as Record<string, unknown>;
    const method = sanitizeText(row.authenticity_method);
    const url = sanitizeHttpsUrl(row.authenticity_url);
    const verifiedAt = sanitizeText(row.authenticity_verified_at);
    if (method === null && url === null && verifiedAt === null) return null;
    return { method, url, verifiedAt };
  } catch (err) {
    logger.warn('getProductAuthenticity: unexpected error', { error: String(err) });
    return null;
  }
}

/**
 * Fail-safe read of one product's recorded supply-chain info
 * (migration 033). Returns null when nothing is recorded, when the
 * columns do not exist yet, when RLS blocks the read, or on any
 * error. Never throws. No origin, manufacturer, or certification
 * is ever invented here.
 */
export async function getProductSupplyChain(
  supabase: AnySupabaseClient,
  productId: string
): Promise<ProductSupplyChainData | null> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select(
        'country_of_origin, manufacturer_name, certifications, supply_chain_note, supply_chain_source_url'
      )
      .eq('id', productId)
      .maybeSingle();
    if (error || !data) {
      if (error) {
        logger.warn('getProductSupplyChain: query failed (033 may not be run)', {
          error: error.message,
        });
      }
      return null;
    }
    const row = data as Record<string, unknown>;
    const countryOfOrigin = sanitizeText(row.country_of_origin);
    const manufacturerName = sanitizeText(row.manufacturer_name);
    const certifications = sanitizeCertifications(row.certifications);
    const note = sanitizeText(row.supply_chain_note);
    const sourceUrl = sanitizeHttpsUrl(row.supply_chain_source_url);
    if (
      countryOfOrigin === null &&
      manufacturerName === null &&
      certifications.length === 0 &&
      note === null &&
      sourceUrl === null
    ) {
      return null;
    }
    return { countryOfOrigin, manufacturerName, certifications, note, sourceUrl };
  } catch (err) {
    logger.warn('getProductSupplyChain: unexpected error', { error: String(err) });
    return null;
  }
}
