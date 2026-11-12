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
 *
 * FAIL-OPEN, always: any fetch error, timeout, non-200 from
 * Supabase, or missing env resolves to 'pass' — the request
 * proceeds exactly as before the fix (200 + the page's own
 * not-found content). A 404 is returned ONLY on a positive
 * "does not exist" answer. Never 500, never blocks a valid page.
 */

export type SlugKind = 'product' | 'brand' | 'category';

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
 * the three slug routes. Only exactly-two-segment paths match, so
 * the index pages (/products, /brands, /categories) and any deeper
 * sub-paths pass through untouched.
 */
export function matchSlugRoute(pathname: string): {
  kind: SlugKind;
  slug: string;
} | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length !== 2) return null;
  const [head, rawSlug] = parts;
  if (head !== 'products' && head !== 'brands' && head !== 'categories') {
    return null;
  }
  let slug: string;
  try {
    slug = decodeURIComponent(rawSlug);
  } catch {
    // Malformed percent-encoding — fail open, let the page handle it.
    return null;
  }
  if (!slug) return null;
  const kind: SlugKind =
    head === 'products' ? 'product' : head === 'brands' ? 'brand' : 'category';
  return { kind, slug };
}

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
 */
export async function slugExists(
  kind: SlugKind,
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
 */
export async function resolveSlugRequest(
  pathname: string,
  env: SlugCheckEnv = readSlugCheckEnv(),
  fetchFn: typeof fetch = fetch
): Promise<SlugDecision> {
  const match = matchSlugRoute(pathname);
  if (!match) return 'pass';
  try {
    const exists = await slugExists(match.kind, match.slug, env, fetchFn);
    return exists ? 'pass' : 'rewrite';
  } catch {
    return 'pass';
  }
}
