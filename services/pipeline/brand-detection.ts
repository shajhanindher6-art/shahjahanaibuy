/**
 * Brand detection service — matches provider brand strings to internal brands.
 * Creates new brand records when no match is found.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { nearMissSimilarity, NEAR_MISS_THRESHOLD } from '@/lib/fuzzy-match';

export interface BrandDetectionResult {
  brandId: string | null;
  detected: boolean;
  created: boolean;
  /**
   * Section 18, item 23: the resolved brand's canonical name —
   * the text `products.brand` value that keeps text-based reads
   * working. Non-null exactly when brandId is non-null.
   */
  name: string | null;
  /**
   * Section 21–25, Stage C (B6): how the brand was resolved.
   * 'fuzzy' means the incoming name was a near-miss of an existing
   * brand (similarity ≥ 0.75) and was matched to it instead of
   * creating a duplicate brand row.
   */
  matchedBy?: 'exact' | 'fuzzy';
}

function slugifyBrand(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

export async function detectBrand(
  supabase: AnySupabaseClient,
  brandName: string | null
): Promise<BrandDetectionResult> {
  if (!brandName || brandName.trim().length === 0) {
    return { brandId: null, detected: false, created: false, name: null };
  }

  const trimmed = brandName.trim();
  const slug = slugifyBrand(trimmed);

  // Try exact slug match first
  const { data: existing } = await supabase
    .from('brands')
    .select('id, name')
    .eq('slug', slug)
    .is('deleted_at', null)
    .maybeSingle();

  if (existing?.id) {
    return {
      brandId: existing.id,
      detected: true,
      created: false,
      name: (existing as { name?: string }).name ?? trimmed,
    };
  }

  // Try case-insensitive name match
  const { data: byName } = await supabase
    .from('brands')
    .select('id, name')
    .ilike('name', trimmed)
    .is('deleted_at', null)
    .maybeSingle();

  if (byName?.id) {
    return {
      brandId: byName.id,
      detected: true,
      created: false,
      name: (byName as { name?: string }).name ?? trimmed,
    };
  }

  // Section 21–25, Stage C (B6) — fuzzy leg: a near-miss brand
  // ("Sonyy", "Soni") used to silently create a duplicate brand
  // row. Before creating, scan the existing brands and match the
  // closest one at similarity ≥ 0.75 (token Jaccard or bigram
  // Dice — lib/fuzzy-match.ts). A failed list read degrades to
  // "no match" (create as before) rather than blocking ingestion.
  try {
    const { data: allBrands, error } = await supabase
      .from('brands')
      .select('id, name, slug')
      .is('deleted_at', null)
      .limit(200);
    if (!error && allBrands) {
      let best: { id: string; name: string; similarity: number } | null = null;
      for (const row of allBrands as Array<{ id: string; name: string; slug?: string }>) {
        const similarity = Math.max(
          nearMissSimilarity(trimmed, row.name ?? ''),
          nearMissSimilarity(slug, row.slug ?? '')
        );
        if (similarity >= NEAR_MISS_THRESHOLD && (!best || similarity > best.similarity)) {
          best = { id: row.id, name: row.name, similarity };
        }
      }
      if (best) {
        logger.debug('Brand: fuzzy-matched near-miss brand instead of creating', {
          name: trimmed,
          matched: best.name,
          similarity: best.similarity,
        });
        return {
          brandId: best.id,
          detected: true,
          created: false,
          name: best.name,
          matchedBy: 'fuzzy',
        };
      }
    }
  } catch (err) {
    logger.warn('Brand: fuzzy match failed, continuing to create', { error: String(err) });
  }

  // Create new brand
  const { data: newBrand, error } = await supabase
    .from('brands')
    .insert({
      name: trimmed,
      slug,
      active: true,
    })
    .select('id')
    .single();

  if (newBrand?.id) {
    logger.debug('Brand: created new', { name: trimmed, slug, id: newBrand.id });
    return { brandId: newBrand.id, detected: true, created: true, name: trimmed };
  }

  if (error) {
    logger.warn('Brand: insert failed', { error: error.message });
  }

  return { brandId: null, detected: false, created: false, name: null };
}
