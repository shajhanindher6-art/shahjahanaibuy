/**
 * Pre-render slug existence check for the soft-404 middleware fix
 * (2026-11-12).
 *
 * WHY THIS EXISTS — the [slug]/layout.tsx existence checks (pushed
 * 2026-11-12, commit ca6dd62) cannot produce HTTP 404 live. Proven
 * in a minimal Next 13.5.9 repro: the real app has app/loading.tsx
 * (root shell), and ANY notFound() — async OR sync — lets the root
 * LoadingBoundary stream its shell with HTTP 200 first; the
 * notFound() is then swallowed and only its digest survives in the
 * flight payload. (The earlier "sync notFound gives 404" claim was
 * WRONG: it was measured on an underscore-prefixed route that is
 * not routable, so the 404 was just the unknown-route 404.) So the
 * check must run BEFORE any rendering — in middleware — and unknown
 * slugs are rewritten to /__smartbuy_not_found__, a path that
 * matches NO route, so Next returns its routing-level 404 (the real
 * app/not-found.tsx UI, HTTP 404) without rendering anything.
 * Repro proof (root loading.tsx present, 2026-11-12): unknown slug
 * via this rewrite -> 404 + not-found UI; known slug -> 200 +
 * product; direct bad URL -> 404 (control). Never create a route
 * at /__smartbuy_not_found__.
 *
 * EDGE-SAFE by design: this module uses only the global fetch and
 * public env vars (NEXT_PUBLIC_SUPABASE_URL /
 * NEXT_PUBLIC_SUPABASE_ANON_KEY — the anon key is public by design).
 * It never imports the Supabase JS client or any server-only module.
 * The four static registries imported below (search terms, seasonal
 * events, store directory, blog posts) are pure data modules — their
 * import chains were verified to contain no server-only, Node-only,
 * or React code (lib/stores.ts, lib/blog/posts.ts and
 * components/seasonal/events.ts have no imports at all;
 * lib/search-terms.ts pulls only lib/stores.ts and
 * lib/brand-category-seo.ts, whose only imports are a type-only
 * `next` import and the import-free lib/json-ld.ts). They are the
 * SAME getters the pages call, so the middleware mirrors each
 * page's own notFound() logic exactly instead of a copy that can
 * drift. Cost: these registries join the edge middleware bundle.
 *
 * EXISTENCE DEFINITIONS — mirrors the page data layer exactly:
 * - product: a row in `products` with that slug, deleted_at IS NULL,
 *   and slug != 'sample-laptop' (the health-check row — same
 *   exclusion as getProductBySlug in services/products.ts).
 * - brand / category: a product whose brand/category column
 *   slugifies to the URL slug. This is the product-derived
 *   definition resolveTaxonomyPage uses — and the ONLY correct one
 *   here: the /brands and /categories index pages and the sitemap
 *   derive their slugs from products, and the `categories` table is
 *   EMPTY live (getCategoryBySlug returns null for every slug), so a
 *   reference-table check would 404 every real category page.
 *   (Edge case, documented: a reference row with zero products
 *   renders an honest empty state in the page layer but is not
 *   reachable from the index or sitemap, so the middleware treats
 *   it as unknown. The page layer's own check still applies on
 *   the pass-through path.)
 * - find: getSearchTermBySlug(query) is non-null — the slug is one
 *   of the 500 curated SEARCH_TERMS (lib/search-terms.ts). The
 *   getter slugifies its input, so mixed case / spaces resolve
 *   exactly as the page does (app/find/[query]/page.tsx:92).
 * - event: getEventBySlug(slug) finds one of the 5 SEASONAL_EVENTS
 *   (components/seasonal/events.ts, exact match —
 *   app/events/[slug]/page.tsx:52).
 * - blog: getPostBySlug(slug) finds one of the 21 POSTS
 *   (lib/blog/posts.ts, exact match — app/blog/[slug]/page.tsx:157).
 * - store: findStorePage(country, slug) is non-null — the
 *   (country, slug) pair is one of the 84 store pages (80 local +
 *   4 worldwide under `global`, lib/store-directory.ts,
 *   case-insensitive — app/stores/[country]/[slug]/page.tsx:76).
 *   A slug that exists only in another country is unknown here,
 *   exactly as the page 404s it.
 * - live: a row in `live_shopping_sessions` with that slug
 *   (app/live/[slug]/page.tsx:119 via getLiveSessionDetail). Until
 *   migration 033 runs the table does not exist: PostgREST answers
 *   non-200, the check throws, and the request FAILS OPEN — the
 *   page then renders its honest "not set up yet" state with 200,
 *   never a 404. A 404 is returned ONLY when the table exists and
 *   positively has no row with that slug.
 * - creator: NOT CHECKABLE with the anon key, so ALWAYS pass
 *   (fail-open by necessity, not by error). The page resolves a
 *   creator via `profiles.creator_slug`
 *   (app/creators/[slug]/page.tsx:72 via getCreatorBySlug), and
 *   that lookup needs the SERVICE-ROLE client because the only
 *   profiles select policy is `profiles_select_own`
 *   (TO authenticated USING auth.uid() = id, migration 001) — an
 *   anon REST query on profiles returns [] for EVERY slug, real
 *   creators included, so checking it would 404 every real
 *   storefront. creator_rewards IS publicly readable but carries
 *   no slug column, so it cannot substitute. Covering /creators
 *   needs an owner-gated data change (e.g. a public read policy
 *   on creator_slug, or a public slug view) — never the service
 *   key in edge middleware. Pinned by tests.
 *
 * FAIL-OPEN, always: any fetch error, timeout, non-200 from
 * Supabase, or missing env resolves to 'pass' — the request
 * proceeds exactly as before the fix (200 + the page's own
 * not-found content). A 404 is returned ONLY on a positive
 * "does not exist" answer. Never 500, never blocks a valid page.
 */

import { getSearchTermBySlug } from '@/lib/search-terms';
import { getEventBySlug } from '@/components/seasonal/events';
import { findStorePage } from '@/lib/store-directory';
import { getPostBySlug } from '@/lib/blog/posts';

export type SlugKind =
  | 'product'
  | 'brand'
  | 'category'
  | 'find'
  | 'event'
  | 'live'
  | 'creator'
  | 'store'
  | 'blog';

export interface SlugCheckEnv {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
}

export function readSlugCheckEnv(): SlugCheckEnv {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null,
  };
}

/** Check budget per slug request — a hung Supabase must not stall the page. */
export const SLUG_CHECK_TIMEOUT_MS = 2000;

/** Upper bound on the taxonomy scan (10 products today; headroom for growth). */
export const TAXONOMY_FETCH_LIMIT = 500;

/**
 * "Apple Inc." -> "apple-inc"; "Home & Garden" -> "home-garden".
 * Duplicated from lib/brand-category-seo.ts (slugify) on purpose so
 * this module stays dependency-free and edge-safe — keep in sync.
 */
export function slugifySlugValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Parse a pathname into a slug check, or null when it is not one of
 * the slug routes. Two-segment paths match /products, /brands,
 * /categories, /find, /events, /live, /creators and /blog; the only
 * three-segment route is /stores/[country]/[slug]. Index pages and
 * any deeper sub-paths pass through untouched. `country` is set
 * only for store routes.
 */
export function matchSlugRoute(pathname: string): {
  kind: SlugKind;
  slug: string;
  country?: string;
} | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 2) {
    const [head, rawSlug] = parts;
    const kindByHead: Record<string, SlugKind> = {
      products: 'product',
      brands: 'brand',
      categories: 'category',
      find: 'find',
      events: 'event',
      live: 'live',
      creators: 'creator',
      blog: 'blog',
    };
    const kind = kindByHead[head];
    if (!kind) return null;
    let slug: string;
    try {
      slug = decodeURIComponent(rawSlug);
    } catch {
      // Malformed percent-encoding — fail open, let the page handle it.
      return null;
    }
    if (!slug) return null;
    return { kind, slug };
  }
  if (parts.length === 3 && parts[0] === 'stores') {
    const [, rawCountry, rawSlug] = parts;
    let country: string;
    let slug: string;
    try {
      country = decodeURIComponent(rawCountry);
      slug = decodeURIComponent(rawSlug);
    } catch {
      // Malformed percent-encoding — fail open, let the page handle it.
      return null;
    }
    if (!country || !slug) return null;
    return { kind: 'store', slug, country };
  }
  return null;
}

/**
 * Pure in-memory existence check for the four static-registry
 * routes — the SAME getters the pages call, so the definition
 * cannot drift from the page's own notFound() logic. No fetch, no
 * env, never throws for a well-formed input. `country` is only
 * read for 'store'.
 */
export function localSlugExists(
  kind: 'find' | 'event' | 'store' | 'blog',
  slug: string,
  country?: string
): boolean {
  switch (kind) {
    case 'find':
      // getSearchTermBySlug slugifies its input — mixed case and
      // spaces resolve exactly as the /find page does.
      return getSearchTermBySlug(slug) !== null;
    case 'event':
      return getEventBySlug(slug) !== undefined;
    case 'blog':
      return getPostBySlug(slug) !== undefined;
    case 'store':
      return findStorePage(country ?? null, slug) !== null;
  }
}

/** Kinds whose existence is checked with one Supabase REST fetch. */
export type RestSlugKind = 'product' | 'brand' | 'category' | 'live';

function restHeaders(anonKey: string): Record<string, string> {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    Accept: 'application/json',
  };
}

/**
 * True when the slug exists, false when it positively does not.
 * THROWS on missing env, fetch failure, timeout, or a non-200 from
 * Supabase — the caller (resolveSlugRequest) turns any throw into a
 * fail-open 'pass'. One REST fetch per call, edge-compatible.
 * Only REST kinds are accepted here: the static-registry kinds
 * (find / event / store / blog) never reach this function — they
 * are answered by localSlugExists — and 'creator' is fail-open by
 * necessity (see the header), so it never reaches it either.
 */
export async function slugExists(
  kind: RestSlugKind,
  slug: string,
  env: SlugCheckEnv,
  fetchFn: typeof fetch = fetch
): Promise<boolean> {
  const { supabaseUrl, supabaseAnonKey } = env;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('slug-exists: Supabase env not configured');
  }
  const headers = restHeaders(supabaseAnonKey);
  const signal = AbortSignal.timeout(SLUG_CHECK_TIMEOUT_MS);

  if (kind === 'product') {
    const url =
      `${supabaseUrl}/rest/v1/products` +
      `?slug=eq.${encodeURIComponent(slug)}` +
      `&deleted_at=is.null` +
      `&slug=neq.sample-laptop` +
      `&select=slug&limit=1`;
    const res = await fetchFn(url, { headers, signal });
    if (!res.ok) {
      throw new Error(`slug-exists: products check HTTP ${res.status}`);
    }
    const rows = (await res.json()) as Array<{ slug: string }>;
    return rows.length > 0;
  }

  if (kind === 'live') {
    // Same shape as the page's getLiveSessionBySlug (slug eq only,
    // no deleted filter — sessions have none). A missing table
    // (migration 033 not run) answers non-200 (PGRST205) -> throw
    // -> fail-open, so the page renders its honest "not set up
    // yet" state instead of a 404.
    const url =
      `${supabaseUrl}/rest/v1/live_shopping_sessions` +
      `?slug=eq.${encodeURIComponent(slug)}` +
      `&select=slug&limit=1`;
    const res = await fetchFn(url, { headers, signal });
    if (!res.ok) {
      throw new Error(`slug-exists: live check HTTP ${res.status}`);
    }
    const rows = (await res.json()) as Array<{ slug: string }>;
    return rows.length > 0;
  }

  // Brand / category: product-derived (see header). One scan of the
  // single text column, slugified client-side.
  const column = kind === 'brand' ? 'brand' : 'category';
  const url =
    `${supabaseUrl}/rest/v1/products` +
    `?select=${column}&limit=${TAXONOMY_FETCH_LIMIT}`;
  const res = await fetchFn(url, { headers, signal });
  if (!res.ok) {
    throw new Error(`slug-exists: ${kind} check HTTP ${res.status}`);
  }
  const rows = (await res.json()) as Array<Record<string, string | null>>;
  return rows.some((row) => {
    const value = row[column];
    return (
      value !== null && value !== undefined && slugifySlugValue(value) === slug
    );
  });
}

export type SlugDecision = 'pass' | 'rewrite';

/**
 * The middleware decision for one pathname. 'rewrite' ONLY when the
 * existence check positively says the slug does not exist; every
 * other outcome — not a slug route, slug exists, or ANY error —
 * is 'pass' (current behaviour preserved).
 *
 * Per-request cost: the four static-registry routes (find / event /
 * store / blog) cost ZERO fetches — a pure in-memory lookup. The
 * REST routes (product / brand / category / live) cost exactly ONE
 * Supabase REST fetch. /creators costs nothing and always passes:
 * the anon key cannot positively determine creator existence
 * (profiles RLS — see the header), so any other answer would risk
 * 404ing real storefronts.
 */
export async function resolveSlugRequest(
  pathname: string,
  env: SlugCheckEnv = readSlugCheckEnv(),
  fetchFn: typeof fetch = fetch
): Promise<SlugDecision> {
  const match = matchSlugRoute(pathname);
  if (!match) return 'pass';
  if (
    match.kind === 'find' ||
    match.kind === 'event' ||
    match.kind === 'store' ||
    match.kind === 'blog'
  ) {
    return localSlugExists(match.kind, match.slug, match.country)
      ? 'pass'
      : 'rewrite';
  }
  if (match.kind === 'creator') return 'pass';
  try {
    const exists = await slugExists(match.kind, match.slug, env, fetchFn);
    return exists ? 'pass' : 'rewrite';
  } catch {
    return 'pass';
  }
}
