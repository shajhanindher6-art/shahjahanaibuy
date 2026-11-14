/**
 * AI Already-Own-It Guard — matching logic (T4, /tools/own-it-check).
 *
 * Before you buy, check whether you already saved this — or an
 * equivalent — product in your OWN saved lists (buy list, wishlists,
 * saved searches, plus the guest lists kept on this device).
 *
 * Matching legs, same pattern as services/pipeline/deduplication.ts
 * findDuplicateCandidates: slug → GTIN → normalized name+brand
 * (exact, then token-similar). Stage 2, S2-4: the GTIN, exact
 * name+brand and fuzzy name+brand legs DELEGATE to that pipeline
 * sweep (one call over [query, ...candidates]) instead of
 * re-implementing them here — the token similarity and both
 * confidence caps are the pipeline's, imported, not copied. The
 * normalizer is the shared `normalizeDedupeText` from the pure
 * lib home `@/lib/normalize` (Stage 2, S2-6b: client-safe, no
 * server imports — this module must stay usable from the client
 * guest-check leaf, so it cannot import the normalizer from
 * services/). `normalizeOwnItText` survives only as a deprecated
 * alias for its tests; all internal call sites use
 * `normalizeDedupeText` directly. Two legs have NO pipeline equivalent and stay local:
 * the slug leg (the sweep has no slug leg) and the name-only leg
 * (exact name with the brand unknown on one side). The dedup
 * module's server-only half (findDuplicate, Supabase reads) is
 * never called from here — only the pure sweep.
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
 * - GTIN validation (lib/gtin.ts validateGtin) runs on the GTIN
 *   leg: a GS1-valid GTIN matches on its validated normalized
 *   form. A GTIN that FAILS validation still matches on
 *   digits-only equality — saved lists predate validation, and
 *   the same mistyped GTIN saved twice is still the same saved
 *   entry, not a silent non-match. Strict gating would drop real
 *   duplicates from legacy lists (and the existing test that
 *   matches GTIN 4548736130383, whose check digit is wrong).
 */

import { normalizeGtin, validateGtin } from '@/lib/gtin';
import { normalizeDedupeText } from '@/lib/normalize';
import {
  findDuplicateCandidates,
  GTIN_MATCH_CONFIDENCE,
  NAME_BRAND_FUZZY_THRESHOLD,
  nameTokenSimilarity,
  type DuplicateCandidate,
  type DuplicateSweepProduct,
} from '@/services/pipeline/deduplication';

/** A fuzzy name match needs the same brand AND a token similarity
 *  at or above this threshold — the pipeline's
 *  NAME_BRAND_FUZZY_THRESHOLD (0.75 catches rewordings like
 *  "MacBook Air 13-inch" vs "MacBook Air 13" while keeping
 *  distinct models apart: "MacBook Air 13" vs "MacBook Pro 13"
 *  scores 0.5). */
export const OWN_IT_FUZZY_THRESHOLD = NAME_BRAND_FUZZY_THRESHOLD;

/** GTIN-match confidence cap — the pipeline's GTIN_MATCH_CONFIDENCE:
 *  a GTIN may be mistyped or reused across a variant family. */
export const OWN_IT_GTIN_CONFIDENCE = GTIN_MATCH_CONFIDENCE;

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

/**
 * @deprecated Alias of the shared `normalizeDedupeText`
 * (`@/lib/normalize`) — kept only because tests/own-it-check.test.ts
 * asserts the old name. New code calls `normalizeDedupeText` directly.
 */
export function normalizeOwnItText(value: string): string {
  return normalizeDedupeText(value);
}

/**
 * Token-set Jaccard similarity between two normalized names
 * (0 = no shared token, 1 = identical token sets). Order-free,
 * so "Air 13 MacBook" and "MacBook Air 13" score 1 — the
 * pipeline's nameTokenSimilarity (Stage 2, S2-4: imported,
 * not re-implemented).
 */
export function ownItNameSimilarity(a: string, b: string): number {
  return nameTokenSimilarity(a, b);
}

/**
 * The GTIN comparison key for one side of the GTIN leg (Stage 2,
 * S2-4). Normalization is lib/gtin.ts's normalizeGtin (digits
 * only, separators stripped); when the value is a GS1-valid GTIN,
 * validateGtin's normalized form is the key. When it is NOT valid
 * (wrong length / wrong check digit — e.g. a GTIN typed by hand
 * into a saved list), the key falls back to digits-only equality
 * so the same mistyped GTIN saved twice still matches (see the
 * header: strict gating would silently drop real duplicates).
 * Null when the value carries no digits at all.
 */
function gtinMatchKey(value: string | null | undefined): string | null {
  const normalized = normalizeGtin(value);
  if (normalized === null) return null;
  const validation = validateGtin(normalized);
  if (validation.valid) return validation.normalized;
  const digits = normalized.replace(/[^0-9]/g, '');
  return digits.length > 0 ? digits : null;
}

/**
 * Find saved-list entries that match the query. Legs run in
 * order — slug, GTIN, exact name+brand, exact name-only, fuzzy
 * name+brand — and each candidate reports its best (first) leg
 * only, so one saved entry never appears twice. Results are
 * sorted by confidence, exact matches first.
 *
 * Stage 2, S2-4: the GTIN, exact name+brand and fuzzy name+brand
 * legs are the pipeline's findDuplicateCandidates, run once over
 * [query, ...candidates] (synthetic sweep ids, so real candidate
 * ids never collide). The slug leg and the name-only leg have no
 * pipeline equivalent and run locally, in their original order
 * around the sweep results.
 *
 * An empty or blank query name matches nothing: a check with no
 * product to check is not a check.
 */
export function findOwnItMatches(
  query: OwnItQuery,
  candidates: OwnItCandidate[]
): OwnItMatch[] {
  const queryName = normalizeDedupeText(query.name ?? '');
  if (queryName === '') return [];
  const querySlug = (query.slug ?? '').trim().toLowerCase();
  const queryBrand = query.brand ?? null;

  // Shared legs via the pipeline sweep. The query is sweep row 0;
  // each candidate is a later row, so a sweep hit for a candidate
  // always has duplicateOfProductId === the query row.
  const QUERY_ROW_ID = '__own_it_query__';
  const sweepProducts: DuplicateSweepProduct[] = [
    {
      id: QUERY_ROW_ID,
      slug: querySlug || QUERY_ROW_ID,
      name: query.name,
      brand: queryBrand,
      gtin: gtinMatchKey(query.gtin),
    },
    ...candidates.map((candidate, index) => ({
      id: `__own_it_candidate_${index}__`,
      slug: candidate.slug ?? '',
      name: candidate.name,
      brand: candidate.brand ?? null,
      gtin: gtinMatchKey(candidate.gtin),
    })),
  ];
  const sweepByCandidate = new Map<string, DuplicateCandidate>();
  for (const hit of findDuplicateCandidates(sweepProducts)) {
    if (hit.duplicateOfProductId === QUERY_ROW_ID) {
      sweepByCandidate.set(hit.productId, hit);
    }
  }

  const matches: OwnItMatch[] = [];
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    const candidateSlug = (candidate.slug ?? '').trim().toLowerCase();
    // Slug leg (local — the sweep has no slug leg).
    if (querySlug !== '' && candidateSlug !== '' && candidateSlug === querySlug) {
      matches.push({ candidate, matchedBy: 'slug', confidence: 1, exact: true });
      continue;
    }
    // GTIN / exact name+brand / fuzzy name+brand legs (pipeline sweep).
    const shared = sweepByCandidate.get(`__own_it_candidate_${index}__`);
    if (shared) {
      if (shared.matchedBy === 'gtin') {
        matches.push({
          candidate,
          matchedBy: 'gtin',
          confidence: OWN_IT_GTIN_CONFIDENCE,
          exact: true,
        });
        continue;
      }
      if (shared.matchedBy === 'name-brand') {
        matches.push({ candidate, matchedBy: 'name-brand-exact', confidence: 1, exact: true });
        continue;
      }
      matches.push({
        candidate,
        matchedBy: 'name-brand-fuzzy',
        confidence: Math.round(shared.confidence * 100) / 100,
        exact: false,
      });
      continue;
    }
    // Name-only leg (local — the sweep needs a brand on both sides):
    // exact name with the brand unknown on one side.
    const candidateName = normalizeDedupeText(candidate.name ?? '');
    if (candidateName === '') continue;
    const candidateBrand = candidate.brand ?? null;
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
  const haystack = normalizeDedupeText(
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
    const tokens = normalizeDedupeText(q).split(' ').filter(Boolean);
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
  // Stage 2, S2-4: the GTIN check reuses the leg's key — a GTIN
  // with no digits at all is not a GTIN (lib/gtin.ts normalize
  // strips separators, so '---' still has no digits).
  if (gtin !== null && gtin !== '' && gtinMatchKey(gtin) === null) {
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
