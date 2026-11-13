/**
 * FINAL 100% — product gallery image writes/reads with verification
 * status (F-P1-40, F-P2-30, F-P2-34).
 *
 * `product_images` (migration 002) has only url / alt_text /
 * is_primary / sort_order. Migration 069 (written by another
 * worker, owner-applied) adds `verification_status` /
 * `checked_at`. This module is the code that writes/reads those
 * columns when present and degrades honestly when absent:
 *
 * - `insertProductImagesWithVerification` tries the 069 columns
 *   first; on Postgres 42703 it retries with only the 002
 *   columns and reports `verificationMissing: true` — the rows
 *   land, the verification verdict does not, and the caller can
 *   say so instead of claiming a check was stored.
 * - Alt text is derived honestly at write time (F-P2-30): the
 *   primary image gets the product name, later images get
 *   "<name> photo N". No descriptive content is ever invented —
 *   the alt text names the product and the image's role, nothing
 *   about what the picture shows.
 * - `getProductImagesWithVerification` reads the same way, with
 *   the same 42703 fallback, so the public read never 500s over
 *   an unapplied migration.
 *
 * This is also the gallery path intake approve now uses (F-P2-34):
 * approve used to store `image_url` only, so `product_images`
 * was unreachable from the working intake. Approve now writes a
 * gallery row for the primary image (and any `image_urls`) via
 * this module.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import type {
  DetailedProcessedImage,
  ImageVerificationStatus,
} from '@/services/pipeline/image-processing';

/** A gallery image as stored, with its verification verdict when known. */
export interface StoredProductImage {
  id: string;
  url: string;
  altText: string | null;
  isPrimary: boolean;
  sortOrder: number;
  /** Per-image verification verdict (null when 069 is unapplied). */
  verificationStatus: ImageVerificationStatus | null;
  /** When the verdict was recorded (null when 069 is unapplied). */
  checkedAt: string | null;
}

function isUndefinedColumnError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42703';
}

/**
 * Honest alt text for a gallery image: the product name for the
 * primary image, "<name> photo N" for the rest. Never invents
 * descriptive content — it names the product and the image's
 * role only. Exported so tests and other writers share the rule.
 */
export function deriveImageAltText(
  productName: string,
  isPrimary: boolean,
  index: number
): string {
  const name = productName.trim() || 'Product';
  return isPrimary ? name : `${name} photo ${index + 1}`;
}

export interface InsertGalleryImagesInput {
  /** Gallery rows to store (detailed pipeline results). */
  images: DetailedProcessedImage[];
  /** Product name, for honest alt text. */
  productName: string;
}

export interface InsertGalleryImagesResult {
  inserted: number;
  /** True when rows landed without verification columns (069 unapplied). */
  verificationMissing: boolean;
  error: string | null;
}

/**
 * Insert gallery rows with per-image verification status. Rows
 * already stored for this product (same normalized URL) are
 * skipped — re-ingest must not duplicate the gallery. Never
 * throws on a missing column; reports it instead.
 */
export async function insertProductImagesWithVerification(
  supabase: AnySupabaseClient,
  productId: string,
  input: InsertGalleryImagesInput
): Promise<InsertGalleryImagesResult> {
  if (input.images.length === 0) return { inserted: 0, verificationMissing: false, error: null };
  // Skip URLs already stored for this product (re-ingest safety).
  let existingUrls = new Set<string>();
  try {
    const { data } = (await supabase
      .from('product_images')
      .select('url')
      .eq('product_id', productId)) as unknown as {
      data: Array<{ url: string }> | null;
      error: unknown;
    };
    existingUrls = new Set((data ?? []).map((r) => String(r.url).trim()));
  } catch {
    existingUrls = new Set<string>();
  }
  const fresh = input.images.filter((img) => !existingUrls.has(img.url.trim()));
  if (fresh.length === 0) return { inserted: 0, verificationMissing: false, error: null };

  const nowIso = new Date().toISOString();
  const rows = fresh.map((img, i) => ({
    product_id: productId,
    url: img.url,
    alt_text: deriveImageAltText(input.productName, img.isPrimary, i),
    is_primary: img.isPrimary,
    sort_order: i,
    verification_status: img.verificationStatus,
    checked_at: img.verificationStatus === 'unchecked' ? null : nowIso,
  }));
  const { error } = (await supabase.from('product_images').insert(rows)) as {
    error: { message: string; code?: string } | null;
  };
  if (error && isUndefinedColumnError(error)) {
    const legacyRows = rows.map((row) => ({
      product_id: row.product_id,
      url: row.url,
      alt_text: row.alt_text,
      is_primary: row.is_primary,
      sort_order: row.sort_order,
    }));
    const retry = (await supabase.from('product_images').insert(legacyRows)) as {
      error: { message: string; code?: string } | null;
    };
    if (retry.error) return { inserted: 0, verificationMissing: true, error: retry.error.message };
    return { inserted: legacyRows.length, verificationMissing: true, error: null };
  }
  if (error) return { inserted: 0, verificationMissing: false, error: error.message };
  return { inserted: rows.length, verificationMissing: false, error: null };
}

/**
 * Read a product's gallery images with their verification
 * verdicts when migration 069 has applied; without it the
 * verdicts read as null (unknown), never as "verified".
 */
export async function getProductImagesWithVerification(
  supabase: AnySupabaseClient,
  productId: string
): Promise<{ images: StoredProductImage[]; verificationMissing: boolean; error?: string }> {
  const mapRow = (
    row: Record<string, unknown>,
    withVerification: boolean
  ): StoredProductImage => ({
    id: String(row.id),
    url: String(row.url),
    altText: (row.alt_text as string | null) ?? null,
    isPrimary: Boolean(row.is_primary),
    sortOrder: typeof row.sort_order === 'number' ? row.sort_order : 0,
    verificationStatus: withVerification
      ? ((row.verification_status as ImageVerificationStatus | null) ?? null)
      : null,
    checkedAt: withVerification ? ((row.checked_at as string | null) ?? null) : null,
  });
  const runQuery = async (withVerification: boolean) => {
    const columns = withVerification
      ? 'id, url, alt_text, is_primary, sort_order, verification_status, checked_at'
      : 'id, url, alt_text, is_primary, sort_order';
    return (await supabase
      .from('product_images')
      .select(columns)
      .eq('product_id', productId)
      .order('sort_order', { ascending: true })) as unknown as {
      data: Record<string, unknown>[] | null;
      error: { code?: string; message: string } | null;
    };
  };
  try {
    let { data, error } = await runQuery(true);
    let verificationMissing = false;
    if (error && isUndefinedColumnError(error)) {
      verificationMissing = true;
      ({ data, error } = await runQuery(false));
    }
    if (error) return { images: [], verificationMissing, error: error.message };
    return {
      images: (data ?? []).map((row) => mapRow(row, !verificationMissing)),
      verificationMissing,
    };
  } catch (err) {
    return { images: [], verificationMissing: false, error: String(err) };
  }
}
