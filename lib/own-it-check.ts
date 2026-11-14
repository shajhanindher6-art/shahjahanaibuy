/**
 * AI Already-Own-It Guard — matching logic (T4, /tools/own-it-check).
 *
 * Before you buy, check whether you already saved this — or an
 * equivalent — product in your OWN saved lists (buy list, wishlists,
 * saved searches, plus the guest lists kept on this device).
 *
 * Matching legs, same pattern as services/pipeline/deduplication.ts
 * findDuplicateCandidates: slug → GTIN → normalized name+brand
 * (exact, then token-similar). The dedup module itself is a server
 * pipeline (Supabase queries + logger), so the normalizer and the
 * token similarity are re-implemented here as pure functions with
 * identical behaviour, keeping this module dependency-free and
 * usable from both the server page and the client guest-check leaf.
 *
 * HONESTY (do not weaken):
 * - No purchase history is recorded anywhere — this checks saved
 *   lists ONLY. A non-match reads "No duplicate found in your
 *   saved lists", never "you don't own this".
 * - A GTIN match is a strong signal, never identity proof: same
 *   0.9 confidence cap as the pipeline (GTIN_MATCH_CONFIDENCE).
 *   Slug and exact name+brand matches stay at 1.0: those are
 *   exact-string identities, not format checks.
 * - A fuzzy match is a candidate to review, never proof of a
 *   duplicate — the UI labels it "similar", not "duplicate".
 */

/** A fuzzy name match needs the same brand AND a token similarity
 *  at or above this threshold — same value as the pipeline's
 *  NAME_BRAND_FUZZY_THRESHOLD (0.75 catches rewordings like
 *  "MacBook Air 13-inch" vs "MacBook Air 13" while keeping
 *  distinct models apart: "MacBook Air 13" vs "MacBook Pro 13"
 *  scores 0.5). */
export const OWN_IT_FUZZY_THRESHOLD = 0.75;

/** GTIN-match confidence cap — same as the pipeline: a GTIN may
 *  be mistyped or reused across a variant family. */
export const OWN_IT_GTIN_CONFIDENCE = 0.9;

/** Exact name-only match (brand unknown on one side) confidence:
 *  strong, but below a name+brand exact match. */
export const OWN_IT_NAME_ONLY_CONFIDENCE = 0.9;

export type OwnItSource =
  | 'buy-list'
  | 'wishlist'
  | 'guest-buy-list'
  | 'guest-wishlist';

export type OwnItMatchedBy =
  | 'slug'
  | 'gtin'
  | 'name-brand-exact'
  | 'name-exact'
  | 'name-brand-fuzzy';

/** The product (or typed description) being checked. */
export interface OwnItQuery {
  slug?: string | null;
  name: string;
  brand?: string | null;
  gtin?: string | null;
}

/** One saved entry, from any list. Brand/GTIN are null when the
 *  list does not record them (guest lists store id/slug/name
 *  only; buy-list rows carry name/slug only). */
export interface OwnItCandidate {
  id: string;
  source: OwnItSource;
  /** Human label for the list, e.g. "Buy list" or a wishlist name. */
  listLabel: string;
  slug?: string | null;
  name: string;
  brand?: string | null;
  gtin?: string | null;
}

export interface OwnItMatch {
  candidate: OwnItCandidate;
  matchedBy: OwnItMatchedBy;
  /** 1.0 = exact identity; 0.9 = GTIN / name-only; fuzzy = the
   *  computed token similarity (>= 0.75). */
  confidence: number;
  /** True only for the exact legs (slug / GTIN / exact name).
   *  A fuzzy match is "similar", not a confirmed duplicate. */
  exact: boolean;
}

/** Lower-case, collapse all non-alphanumerics to single spaces —
 *  identical to the pipeline's normalizeDedupeText. */
export function normalizeOwnItText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Token-set Jaccard similarity between two normalized names
 * (0 = no shared token, 1 = identical token sets). Order-free,
 * so "Air 13 MacBook" and "MacBook Air 13" score 1 — same as
 * the pipeline's nameTokenSimilarity.
 */
export function ownItNameSimilarity(a: string, b: string): number {
  const tokensA = new Set(normalizeOwnItText(a).split(' ').filter(Boolean));
  const tokensB = new Set(normalizeOwnItText(b).split(' ').filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let shared = 0;
  for (const token of tokensA) if (tokensB.has(token)) shared++;
  return shared / (tokensA.size + tokensB.size - shared);
}

function normalizeGtin(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/[^0-9]/g, '');
  return digits.length > 0 ? digits : null;
}

function sameBrand(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeOwnItText(a) === normalizeOwnItText(b);
}

/**
 * Find saved-list entries that match the query. Legs run in
 * order — slug, GTIN, exact name+brand, exact name-only, fuzzy
 * name+brand — and each candidate reports its best (first) leg
 * only, so one saved entry never appears twice. Results are
 * sorted by confidence, exact matches first.
 *
 * An empty or blank query name matches nothing: a check with no
 * product to check is not a check.
 */
export function findOwnItMatches(
  query: OwnItQuery,
  candidates: OwnItCandidate[]
): OwnItMatch[] {
  const queryName = normalizeOwnItText(query.name ?? '');
  if (queryName === '') return [];
  const querySlug = (query.slug ?? '').trim().toLowerCase();
  const queryGtin = normalizeGtin(query.gtin);
  const queryBrand = query.brand ?? null;

  const matches: OwnItMatch[] = [];
  for (const candidate of candidates) {
    const candidateSlug = (candidate.slug ?? '').trim().toLowerCase();
    if (querySlug !== '' && candidateSlug !== '' && candidateSlug === querySlug) {
      matches.push({ candidate, matchedBy: 'slug', confidence: 1, exact: true });
      continue;
    }
    const candidateGtin = normalizeGtin(candidate.gtin);
    if (queryGtin !== null && candidateGtin !== null && candidateGtin === queryGtin) {
      matches.push({
        candidate,
        matchedBy: 'gtin',
        confidence: OWN_IT_GTIN_CONFIDENCE,
        exact: true,
      });
      continue;
    }
    const candidateName = normalizeOwnItText(candidate.name ?? '');
    if (candidateName === '') continue;
    const candidateBrand = candidate.brand ?? null;
    if (candidateName === queryName && sameBrand(candidateBrand, queryBrand)) {
      matches.push({ candidate, matchedBy: 'name-brand-exact', confidence: 1, exact: true });
      continue;
    }
    if (candidateName === queryName && (candidateBrand === null || queryBrand === null)) {
      // Brand unknown on one side — an exact name is still a
      // match, but it cannot claim the brand leg, so it caps
      // at 0.9 like a GTIN match.
      matches.push({
        candidate,
        matchedBy: 'name-exact',
        confidence: OWN_IT_NAME_ONLY_CONFIDENCE,
        exact: true,
      });
      continue;
    }
    if (sameBrand(candidateBrand, queryBrand)) {
      const similarity = ownItNameSimilarity(query.name, candidate.name);
      if (similarity >= OWN_IT_FUZZY_THRESHOLD) {
        matches.push({
          candidate,
          matchedBy: 'name-brand-fuzzy',
          confidence: Math.round(similarity * 100) / 100,
          exact: false,
        });
      }
    }
  }
  return matches.sort((a, b) => b.confidence - a.confidence);
}

// ---------------------------------------------------------------------------
// Saved searches
// ---------------------------------------------------------------------------

/** One saved search, as the page reads it (name + query string). */
export interface OwnItSavedSearch {
  id: string;
  name: string;
  query: string;
}

export interface OwnItSavedSearchMatch {
  search: OwnItSavedSearch;
  /** The `q` text that matched, as the user typed it. */
  matchedQuery: string;
}

/**
 * Which saved searches already cover this product? A saved search
 * is a weaker signal than a saved product — it means the user
 * looked for this before, not that they saved it — so it is
 * reported separately from findOwnItMatches, never as a duplicate.
 *
 * Same AND semantics as services/saved-searches.ts
 * findSavedSearchMatches: every `q` token must appear in the
 * product's name+brand text. A search with no `q` (or no tokens)
 * matches nothing — it is a filter-only save, not a product query.
 */
export function matchOwnItSavedSearches(
  query: OwnItQuery,
  searches: OwnItSavedSearch[]
): OwnItSavedSearchMatch[] {
  const haystack = normalizeOwnItText(
    `${query.name ?? ''} ${query.brand ?? ''}`
  );
  if (haystack === '') return [];
  const haystackTokens = new Set(haystack.split(' ').filter(Boolean));
  const out: OwnItSavedSearchMatch[] = [];
  for (const search of searches) {
    let q = '';
    try {
      q = new URLSearchParams(search.query ?? '').get('q') ?? '';
    } catch {
      q = '';
    }
    const tokens = normalizeOwnItText(q).split(' ').filter(Boolean);
    if (tokens.length === 0) continue;
    if (tokens.every((t) => haystackTokens.has(t))) {
      out.push({ search, matchedQuery: q });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Query params (?product=… | ?name=…&brand=…&gtin=…)
// ---------------------------------------------------------------------------

export const OWN_IT_MAX_NAME_LENGTH = 200;
export const OWN_IT_MAX_BRAND_LENGTH = 100;

export interface OwnItCheckParams {
  /** Catalog slug from ?product=, when present. */
  productSlug: string | null;
  /** Free-typed product name from ?name=. */
  name: string | null;
  brand: string | null;
  gtin: string | null;
  /** Human-readable validation error, or null when the params
   *  are usable (or absent — no query yet is not an error). */
  error: string | null;
}

function firstParam(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

/**
 * Parse the GET form's params. A query is present when ?product=
 * or ?name= is given. Invalid input (over-long name/brand, a GTIN
 * with no digits) returns an error instead of a fabricated query.
 */
export function parseOwnItCheckParams(searchParams: {
  product?: string | string[];
  name?: string | string[];
  brand?: string | string[];
  gtin?: string | string[];
}): OwnItCheckParams {
  const productSlug = firstParam(searchParams.product)?.trim() || null;
  const rawName = firstParam(searchParams.name);
  const rawBrand = firstParam(searchParams.brand);
  const rawGtin = firstParam(searchParams.gtin);
  const name = rawName !== null ? rawName.trim() : null;
  const brand = rawBrand !== null ? rawBrand.trim() : null;
  const gtin = rawGtin !== null ? rawGtin.trim() : null;

  if (name !== null && name.length > OWN_IT_MAX_NAME_LENGTH) {
    return {
      productSlug,
      name,
      brand,
      gtin,
      error: `Product name must be ${OWN_IT_MAX_NAME_LENGTH} characters or fewer.`,
    };
  }
  if (brand !== null && brand.length > OWN_IT_MAX_BRAND_LENGTH) {
    return {
      productSlug,
      name,
      brand,
      gtin,
      error: `Brand must be ${OWN_IT_MAX_BRAND_LENGTH} characters or fewer.`,
    };
  }
  if (gtin !== null && gtin !== '' && normalizeGtin(gtin) === null) {
    return {
      productSlug,
      name,
      brand,
      gtin,
      error: 'GTIN must contain at least one digit.',
    };
  }
  return { productSlug, name: name === '' ? null : name, brand, gtin, error: null };
}
