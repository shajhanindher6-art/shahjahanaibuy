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
import {
  SEARCH_SYNONYMS,
  computeTokenMatches,
  expandSearchTokens,
  parseSearchIntent,
  tokenizeSearchTerms,
} from '@/services/ai-search';
import { queueNotification } from '@/services/notifications';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SavedSearch {
  id: string;
  userId: string;
  name: string;
  /** The /search query string, e.g. "q=laptop&sort=price-asc". */
  query: string;
  /**
   * Section 16, #32 — opted in to "notify me when a new product
   * matches this saved search" (migration 042 column; false until
   * the owner applies it AND the user turns it on).
   */
  notifyOnMatch: boolean;
  /**
   * Section 16, #32 — last time the refresh chain queued a match
   * notification for this search; null = never notified. The
   * matcher only considers products created after this timestamp.
   */
  lastNotifiedAt: string | null;
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
  notify_on_match?: boolean | null;
  last_notified_at?: string | null;
  created_at: string;
  updated_at: string;
}

function mapSavedSearch(row: SavedSearchRow): SavedSearch {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    query: row.query,
    // Pre-042 rows (migration unapplied) carry no columns — read
    // as opted-out / never notified, never as a missing search.
    notifyOnMatch: row.notify_on_match ?? false,
    lastNotifiedAt: row.last_notified_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Postgres "relation does not exist" — migration 039 unapplied.
 * Supabase PostgREST reports a missing table as PGRST205
 * ("Could not find the table ..."), NOT 42P01 — both codes (and
 * the PostgREST message) must be recognised, or a missing table
 * is misread as a generic load failure (which made the refresh
 * chain report completed_with_failures while 042 was unapplied). */
function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /relation .* does not exist/i.test(error.message ?? '') ||
    /could not find the table/i.test(error.message ?? '')
  );
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
      .select('id, user_id, name, query, notify_on_match, last_notified_at, created_at, updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      // Final 100%, F-P2-60 — hard cap 100 (was unbounded).
      .limit(100);
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
      .select('id, user_id, name, query, notify_on_match, last_notified_at, created_at, updated_at')
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

// ---------------------------------------------------------------------------
// Match notifications (Section 16, #32)
// ---------------------------------------------------------------------------

export type SetSavedSearchNotifyError = 'missing-table' | 'not-found' | 'failed';

/**
 * Turn match notifications on/off for one of the caller's saved
 * searches. Turning ON also stamps last_notified_at = now, so
 * only products added AFTER the opt-in can ever match — enabling
 * notifications never spams the user with the existing catalog.
 * Turning OFF clears nothing else; re-enabling re-stamps the
 * timestamp. Returns the updated row, or a discriminated error:
 * 'missing-table' (migration 042 unapplied → 503), 'not-found'
 * (id does not exist or belongs to someone else → 404), 'failed'.
 */
export async function setSavedSearchNotify(
  supabase: AnySupabaseClient,
  userId: string,
  id: string,
  notify: boolean
): Promise<{ savedSearch: SavedSearch } | { error: SetSavedSearchNotifyError }> {
  if (typeof id !== 'string' || id.trim() === '') return { error: 'not-found' };
  try {
    const update: { notify_on_match: boolean; last_notified_at?: string } = {
      notify_on_match: notify,
    };
    if (notify) update.last_notified_at = new Date().toISOString();
    const { data, error } = await supabase
      .from('saved_searches')
      .update(update)
      .eq('user_id', userId)
      .eq('id', id)
      .select('id, user_id, name, query, notify_on_match, last_notified_at, created_at, updated_at')
      .single();
    if (error || !data) {
      if (error && isMissingTableError(error)) return { error: 'missing-table' };
      if (error && error.code === 'PGRST116') return { error: 'not-found' };
      if (error) {
        logger.warn('setSavedSearchNotify: update failed', { error: error.message });
      }
      return { error: 'not-found' };
    }
    return { savedSearch: mapSavedSearch(data as unknown as SavedSearchRow) };
  } catch (err) {
    logger.error('setSavedSearchNotify: unexpected error', { error: String(err) });
    return { error: 'failed' };
  }
}

/** Minimal product shape the matcher needs — name/brand/category/
 *  description text plus created_at (the "new product" clock). */
export interface SavedSearchMatchProduct {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  category: string | null;
  description: string | null;
  createdAt: string;
}

/**
 * Pure matcher: which of `products` match this saved search?
 * The search's `q` is tokenized with the same tokenizer the
 * search itself uses (plus its synonym expansion and
 * typo-tolerant matching), and a product matches only when EVERY
 * q token matches its name/brand/category/description text — a
 * saved search is an AND over its words, so "sony headphones"
 * never matches a Sony TV. A search with no `q` (or no tokens)
 * matches nothing — it is a filter-only save, not a product
 * query. Only products created after `since` (the search's
 * last_notified_at) are considered "new" and returned.
 */
export function findSavedSearchMatches(
  savedSearch: Pick<SavedSearch, 'query' | 'lastNotifiedAt'>,
  products: SavedSearchMatchProduct[]
): SavedSearchMatchProduct[] {
  const params = new URLSearchParams(savedSearch.query);
  const q = params.get('q') ?? '';
  if (q.trim() === '') return [];
  const intent = parseSearchIntent(q);
  // Same token pipeline as the search itself: synonym expansion
  // + typo-tolerant matching (Section 16, #37). A token counts as
  // matched when it OR its synonym matched — "notebook" matches a
  // laptop product via the expanded "laptop" token.
  const originalTokens = tokenizeSearchTerms(q, intent);
  const tokens = expandSearchTokens(originalTokens);
  if (tokens.length === 0) return [];
  const since = savedSearch.lastNotifiedAt ? Date.parse(savedSearch.lastNotifiedAt) : 0;
  return products.filter((product) => {
    if (Number.isFinite(since) && since > 0 && Date.parse(product.createdAt) <= since) return false;
    const { matchedTerms } = computeTokenMatches(tokens, {
      name: product.name,
      brand: product.brand,
      category: product.category,
      description: product.description,
    });
    return originalTokens.every(
      (t) => matchedTerms.includes(t) || (SEARCH_SYNONYMS[t] !== undefined && matchedTerms.includes(SEARCH_SYNONYMS[t]))
    );
  });
}

export interface SavedSearchNotifyResult {
  ok: boolean;
  reason?: 'table-missing' | 'load-failed';
  /** Opted-in searches scanned this run. */
  searchesChecked: number;
  /** Notifications queued (one per search × new matching product). */
  notified: number;
}

/**
 * Refresh-chain step (Section 16, #32): notify opted-in users
 * when a NEW product matches their saved search. Loads every
 * opted-in saved search (service-role client — this reads many
 * users' rows, so it must only ever run from the refresh chain)
 * and the current product set, then queues one notification_queue
 * row per (search, new matching product) via queueNotification —
 * the existing notification pipeline delivers it; nothing here
 * sends email/push directly. After queuing, the search's
 * last_notified_at advances to now so the same product is never
 * notified twice. Fail closed: a missing table (042 unapplied)
 * returns ok:false 'table-missing' and queues nothing.
 *
 * `notify` is injectable for tests; production passes
 * queueNotification.
 */
export async function notifySavedSearchMatches(
  supabase: AnySupabaseClient,
  notify: (
    client: AnySupabaseClient,
    userId: string,
    type: string,
    channel: string,
    subject: string,
    body: string,
    data: Record<string, unknown> | null
  ) => Promise<boolean> = (
    client,
    userId,
    type,
    channel,
    subject,
    body,
    data
  ) => queueNotification(client, userId, type, channel, subject, body, data)
): Promise<SavedSearchNotifyResult> {
  const empty: SavedSearchNotifyResult = { ok: false, searchesChecked: 0, notified: 0 };
  try {
    const { data: searchRows, error: searchError } = await supabase
      .from('saved_searches')
      .select('id, user_id, name, query, notify_on_match, last_notified_at, created_at, updated_at')
      .eq('notify_on_match', true)
      .order('created_at', { ascending: true });
    if (searchError) {
      if (isMissingTableError(searchError)) return { ...empty, reason: 'table-missing' };
      logger.warn('notifySavedSearchMatches: saved-search load failed', {
        error: searchError.message,
      });
      return { ...empty, reason: 'load-failed' };
    }
    const searches = ((searchRows ?? []) as unknown as SavedSearchRow[]).map(mapSavedSearch);
    if (searches.length === 0) return { ok: true, searchesChecked: 0, notified: 0 };

    const { data: productRows, error: productError } = await supabase
      .from('products')
      .select('id, name, slug, brand, category, description, created_at')
      .is('deleted_at', null)
      .neq('slug', 'sample-laptop')
      .order('created_at', { ascending: false })
      .limit(200);
    if (productError || !productRows) {
      logger.warn('notifySavedSearchMatches: product load failed', {
        error: productError?.message,
      });
      return { ok: false, searchesChecked: searches.length, notified: 0, reason: 'load-failed' };
    }
    const products: SavedSearchMatchProduct[] = (productRows as unknown as Array<Record<string, unknown>>).map(
      (row) => ({
        id: String(row.id),
        name: String(row.name),
        slug: String(row.slug),
        brand: (row.brand as string | null) ?? null,
        category: (row.category as string | null) ?? null,
        description: (row.description as string | null) ?? null,
        createdAt: String(row.created_at),
      })
    );

    let notified = 0;
    const now = new Date().toISOString();
    for (const search of searches) {
      const matches = findSavedSearchMatches(search, products);
      for (const product of matches) {
        const queued = await notify(
          supabase,
          search.userId,
          'saved_search_match',
          'in_app',
          `New match for "${search.name}": ${product.name}`,
          `A new product matches your saved search "${search.name}": ${product.name}.`,
          { savedSearchId: search.id, productId: product.id, productSlug: product.slug }
        );
        if (queued) notified++;
      }
      if (matches.length > 0) {
        await supabase
          .from('saved_searches')
          .update({ last_notified_at: now })
          .eq('id', search.id);
      }
    }
    return { ok: true, searchesChecked: searches.length, notified };
  } catch (err) {
    logger.error('notifySavedSearchMatches: unexpected error', { error: String(err) });
    return { ...empty, reason: 'load-failed' };
  }
}
