/**
 * Retailer data access service.
 * Reads from the `retailers` table (Phase 2 core table).
 *
 * All functions accept an `AnySupabaseClient` so they work with both the
 * browser (anon, RLS-enforced) and server (service role) clients.
 *
 * Database snake_case columns are mapped to camelCase TypeScript properties.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import type { Retailer } from '@/types';

// ---------------------------------------------------------------------------
// Row → domain mapper
// ---------------------------------------------------------------------------

interface RetailerRow {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  website_url: string | null;
  active: boolean;
  country: string;
  created_at: string;
  updated_at: string;
}

function mapRetailer(row: RetailerRow): Retailer {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUrl: row.logo_url,
    websiteUrl: row.website_url,
    active: row.active,
    country: row.country,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * List all active retailers, ordered by name.
 * Returns an empty array on error.
 */
export async function getRetailers(
  supabase: AnySupabaseClient
): Promise<Retailer[]> {
  try {
    const { data, error } = await supabase
      .from('retailers')
      .select('id, name, slug, logo_url, website_url, active, country, created_at, updated_at')
      .eq('active', true)
      .order('name', { ascending: true })
      .limit(500);

    if (error || !data) {
      if (error) logger.warn('getRetailers: query failed', { error: error.message });
      return [];
    }

    return data.map((row) => mapRetailer(row as RetailerRow));
  } catch (err) {
    logger.error('getRetailers: unexpected error', { error: String(err) });
    return [];
  }
}

/**
 * Fetch a single retailer by slug.
 * Returns `null` if not found or on error.
 */
export async function getRetailerBySlug(
  supabase: AnySupabaseClient,
  slug: string
): Promise<Retailer | null> {
  try {
    const { data, error } = await supabase
      .from('retailers')
      .select('id, name, slug, logo_url, website_url, active, country, created_at, updated_at')
      .eq('slug', slug)
      .maybeSingle();

    if (error || !data) {
      if (error) logger.warn('getRetailerBySlug: query failed', { error: error.message });
      return null;
    }

    return mapRetailer(data as RetailerRow);
  } catch (err) {
    logger.error('getRetailerBySlug: unexpected error', { error: String(err) });
    return null;
  }
}
