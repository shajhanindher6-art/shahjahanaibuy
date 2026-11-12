/**
 * Saved Searches data access service (Section 15, C2).
 *
 * A saved search is a name + the /search query string (q, sort,
 * store, category, brand, max, minRating, band, page) — the search
 * page already URL-syncs everything, so save = persist the query
 * string and re-run = link back to /search?<query string>.
 *
 * Table: `saved_searches` (migration 039, written NOT applied).
 * Writes go through the AUTHENTICATED server client (the route's
 * createSupabaseServerClient), NOT the service-role client: RLS
 * (auth.uid() = user_id) is the own-only enforcement, and every
 * query below is additionally scoped with .eq('user_id', userId).
 * Ownership is therefore enforced twice — a row can never leak
 * across users even if a policy were dropped.
 *
 * All functions accept an `AnySupabaseClient` so they work with
 * both the authenticated server client and (in tests) a fake.
 * A missing table (migration 039 unapplied) surfaces as a query
 * error, which the service maps to `null` / `[]` — the route turns
 * that into an honest 503 "not available yet", never a fake row.
 * Nothing here ever invents a saved search.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SavedSearch {
  id: string;
  userId: string;
  name: string;
  /** The /search query string, e.g. "q=laptop&sort=price-asc". */
  query: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSavedSearchInput {
  name: string;
  query: string;
}

/** Maximum saved searches per user (enforced in the API route). */
export const MAX_SAVED_SEARCHES = 50;

/** Name: 1–100 chars after trimming. Query string: 1–2000 chars. */
export const MAX_SAVED_SEARCH_NAME_LENGTH = 100;
export const MAX_SAVED_SEARCH_QUERY_LENGTH = 2000;

// ---------------------------------------------------------------------------
// Pure validation + helpers (unit-testable, no DB)
// ---------------------------------------------------------------------------

/**
 * Validate a save request. Returns the trimmed name/query on
 * success, or a human-readable error string. A query string must
 * parse as URL parameters with at least one key — "q=laptop" is a
 * search, an empty string or bare punctuation is not.
 */
export function validateSavedSearchInput(
  input: { name?: unknown; query?: unknown } | null | undefined
): { ok: true; name: string; query: string } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'name and query are required' };
  }
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (name.length === 0) {
    return { ok: false, error: 'name is required' };
  }
  if (name.length > MAX_SAVED_SEARCH_NAME_LENGTH) {
    return {
      ok: false,
      error: `name must be ${MAX_SAVED_SEARCH_NAME_LENGTH} characters or fewer`,
    };
  }
  if (query.length === 0) {
    return { ok: false, error: 'query is required' };
  }
  if (query.length > MAX_SAVED_SEARCH_QUERY_LENGTH) {
    return {
      ok: false,
      error: `query must be ${MAX_SAVED_SEARCH_QUERY_LENGTH} characters or fewer`,
    };
  }
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(query);
  } catch {
    return { ok: false, error: 'query must be a valid search query string' };
  }
  if ([...params.keys()].length === 0) {
    return { ok: false, error: 'query must contain at least one search parameter' };
  }
  return { ok: true, name, query };
}

/** Re-run URL for a saved search — the search page replays it. */
export function buildSavedSearchUrl(query: string): string {
  return `/search?${query}`;
}

// ---------------------------------------------------------------------------
// Row → domain mapper
// ---------------------------------------------------------------------------

interface SavedSearchRow {
  id: string;
  user_id: string;
  name: string;
  query: string;
  created_at: string;
  updated_at: string;
}

function mapSavedSearch(row: SavedSearchRow): SavedSearch {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    query: row.query,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Postgres "relation does not exist" — migration 039 unapplied. */
function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' || /relation .* does not exist/i.test(error.message ?? '');
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

/**
 * List the caller's saved searches, newest first. Returns [] when
 * the user has none — and also when migration 039 is unapplied
 * (no table, so no saved search could exist yet).
 */
export async function listSavedSearches(
  supabase: AnySupabaseClient,
  userId: string
): Promise<SavedSearch[]> {
  try {
    const { data, error } = await supabase
      .from('saved_searches')
      .select('id, user_id, name, query, created_at, updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error || !data) {
      if (error && !isMissingTableError(error)) {
        logger.warn('listSavedSearches: query failed', { error: error.message });
      }
      return [];
    }
    return (data as unknown as SavedSearchRow[]).map(mapSavedSearch);
  } catch (err) {
    logger.error('listSavedSearches: unexpected error', { error: String(err) });
    return [];
  }
}

export type CreateSavedSearchError = 'missing-table' | 'duplicate' | 'invalid' | 'failed';

/**
 * Create a saved search for the caller. Returns the row on success,
 * or a discriminated error so the route can answer honestly:
 * 'missing-table' (migration 039 unapplied → 503 "not available
 * yet"), 'duplicate' (same name already saved → 409), 'invalid'
 * (validation failed → 400), 'failed' (any other DB error → 500).
 * Never a fabricated row. The per-user cap (MAX_SAVED_SEARCHES)
 * is enforced by the route, not here.
 */
export async function createSavedSearch(
  supabase: AnySupabaseClient,
  userId: string,
  input: CreateSavedSearchInput
): Promise<{ savedSearch: SavedSearch } | { error: CreateSavedSearchError }> {
  const validated = validateSavedSearchInput(input);
  if (!validated.ok) return { error: 'invalid' };
  try {
    const { data, error } = await supabase
      .from('saved_searches')
      .insert({
        user_id: userId,
        name: validated.name,
        query: validated.query,
      })
      .select('id, user_id, name, query, created_at, updated_at')
      .single();
    if (error || !data) {
      if (error && isMissingTableError(error)) return { error: 'missing-table' };
      if (error && error.code === '23505') return { error: 'duplicate' };
      if (error) {
        logger.warn('createSavedSearch: insert failed', { error: error.message });
      }
      return { error: 'failed' };
    }
    return { savedSearch: mapSavedSearch(data as unknown as SavedSearchRow) };
  } catch (err) {
    logger.error('createSavedSearch: unexpected error', { error: String(err) });
    return { error: 'failed' };
  }
}

/**
 * Delete one saved search — only when it belongs to the caller.
 * Returns true when a row was actually deleted, false when the id
 * does not exist or belongs to someone else (the route answers
 * 404 in both cases, so existence never leaks across users).
 */
export async function deleteSavedSearch(
  supabase: AnySupabaseClient,
  userId: string,
  id: string
): Promise<boolean> {
  if (typeof id !== 'string' || id.trim() === '') return false;
  try {
    const { data, error } = await supabase
      .from('saved_searches')
      .delete()
      .eq('user_id', userId)
      .eq('id', id)
      .select('id');
    if (error || !data) {
      if (error && !isMissingTableError(error)) {
        logger.warn('deleteSavedSearch: delete failed', { error: error.message });
      }
      return false;
    }
    return (data as unknown[]).length > 0;
  } catch (err) {
    logger.error('deleteSavedSearch: unexpected error', { error: String(err) });
    return false;
  }
}
