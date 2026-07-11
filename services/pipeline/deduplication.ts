/**
 * Deduplication service — prevents duplicate products in the catalog.
 * Strategy: GTIN match (primary) → slug match (fallback).
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import type { NormalizedProduct } from './normalization';

export interface DeduplicationResult {
  existingProductId: string | null;
  isDuplicate: boolean;
  matchedBy: 'gtin' | 'slug' | null;
}

export async function findDuplicate(
  supabase: AnySupabaseClient,
  normalized: NormalizedProduct
): Promise<DeduplicationResult> {
  if (normalized.gtin) {
    const { data } = await supabase
      .from('products')
      .select('id')
      .eq('gtin', normalized.gtin)
      .maybeSingle();

    if (data?.id) {
      logger.debug('Deduplication: GTIN match', { gtin: normalized.gtin, id: data.id });
      return { existingProductId: data.id, isDuplicate: true, matchedBy: 'gtin' };
    }
  }

  const { data } = await supabase
    .from('products')
    .select('id')
    .eq('slug', normalized.slug)
    .maybeSingle();

  if (data?.id) {
    logger.debug('Deduplication: slug match', { slug: normalized.slug, id: data.id });
    return { existingProductId: data.id, isDuplicate: true, matchedBy: 'slug' };
  }

  return { existingProductId: null, isDuplicate: false, matchedBy: null };
}

export async function resolveUniqueSlug(
  supabase: AnySupabaseClient,
  baseSlug: string
): Promise<string> {
  const { data } = await supabase
    .from('products')
    .select('slug')
    .ilike('slug', `${baseSlug}%`)
    .limit(20);

  if (!data || data.length === 0) return baseSlug;
  const existing = new Set(data.map((r) => r.slug));
  if (!existing.has(baseSlug)) return baseSlug;
  let counter = 2;
  while (existing.has(`${baseSlug}-${counter}`)) counter++;
  return `${baseSlug}-${counter}`;
}
