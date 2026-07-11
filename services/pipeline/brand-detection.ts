/**
 * Brand detection service — matches provider brand strings to internal brands.
 * Creates new brand records when no match is found.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';

export interface BrandDetectionResult {
  brandId: string | null;
  detected: boolean;
  created: boolean;
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
    return { brandId: null, detected: false, created: false };
  }

  const trimmed = brandName.trim();
  const slug = slugifyBrand(trimmed);

  // Try exact slug match first
  const { data: existing } = await supabase
    .from('brands')
    .select('id')
    .eq('slug', slug)
    .is('deleted_at', null)
    .maybeSingle();

  if (existing?.id) {
    return { brandId: existing.id, detected: true, created: false };
  }

  // Try case-insensitive name match
  const { data: byName } = await supabase
    .from('brands')
    .select('id')
    .ilike('name', trimmed)
    .is('deleted_at', null)
    .maybeSingle();

  if (byName?.id) {
    return { brandId: byName.id, detected: true, created: false };
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
    return { brandId: newBrand.id, detected: true, created: true };
  }

  if (error) {
    logger.warn('Brand: insert failed', { error: error.message });
  }

  return { brandId: null, detected: false, created: false };
}
