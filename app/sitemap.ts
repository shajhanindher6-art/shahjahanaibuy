/**
 * Single combined sitemap at /sitemap.xml (S2#13 + S4#16).
 *
 * One file covers all three sections: public static pages (hand list
 * below), product pages (live DB slugs, real updated_at), and blog
 * posts (static data file, real datePublished). This is the same
 * single-file shape the site served before the 2026-11-10 batch
 * (verified 32/32 URLs live at the time).
 *
 * WHY NOT THE THREE-FILE SPLIT — READ BEFORE CHANGING THIS: the
 * batch first split this into /sitemap/static.xml,
 * /sitemap/products.xml and /sitemap/blog.xml via the multi-file sitemap API.
 * Central verification (2026-11-10) found all three children
 * prerender as HTTP 404 bodies: in Next 13.5.9 the metadata-route
 * loader's GET compares `item.id.toString() === targetId` where
 * `targetId = __metadata_id__[0]`, but `generateStaticParams`
 * produces `__metadata_id__` values with the `.xml` suffix appended
 * (`'static.xml'` vs id `'static'`), so no id ever matches and the
 * loader returns `new NextResponse('Not Found', { status: 404 })`
 * for every child (see
 * node_modules/next/dist/build/webpack/loaders/next-metadata-route-loader.js,
 * `getDynamicSiteMapRouteCode`). The split is therefore unusable on
 * this Next version and was reverted the same day; do NOT re-add
 * the multi-file sitemap API without first proving a child URL returns 200
 * from a production build. A split can be revisited after a Next.js
 * upgrade, or with hand-written route files instead of the metadata
 * convention. robots.txt (app/robots.ts) lists this single
 * /sitemap.xml, and the owner submits that one URL in Search
 * Console (docs/search-console.md).
 *
 * lastModified — REAL DATES ONLY (S2#13): the old file stamped
 * `new Date()` on every static page, so every generation falsely
 * claimed all pages were just modified. Now:
 *   - products: real `updated_at` from the DB, omitted when null;
 *   - blog posts: real `datePublished`; /blog: latest post's date;
 *   - every other static page: OMITTED — no per-page modification
 *     date is recorded anywhere, and guessing one would be invented
 *     data. (MetadataRoute.Sitemap entries allow lastModified to be
 *     absent; crawlers treat that as "unknown", which is honest.)
 *
 * Section 15 (B3, B6, A3, A4, C1, C9):
 *   - B3 TIMEOUT GUARD — the 4 Supabase-backed sections used to run
 *     sequentially with NO timeout, so one black-holed query hung the
 *     whole sitemap (this killed the sandbox clean build at
 *     /sitemap.xml). Now each runs under AbortSignal.timeout(10s)
 *     on the query itself where the query lives here
 *     (products, taxonomy) plus a withTimeout() bound on the waiter
 *     for the two sections whose queries live in other modules
 *     (live, creators — lib/live-sessions.ts and
 *     lib/creator-storefront.ts take no signal), and all four run
 *     concurrently via Promise.allSettled. A failed/timed-out
 *     section degrades to an empty section — never a failed sitemap.
 *   - A3/A4 — /stores + the 84 /stores/[country]/[slug] pages
 *     (lib/store-directory.ts) and /find + the 500 /find/[query]
 *     pages (lib/search-terms.ts). Both lists are enumerated from
 *     their registries, never hardcoded; the sitemap grows by ~586
 *     URLs, which is expected, and the B3 guard is what keeps
 *     generation safe.
 *   - B6 — /rss.xml + /widgets/embed added (both live 200, were
 *     absent). /offline is DELIBERATELY absent: it is the PWA
 *     offline shell, not content, and must never be indexed.
 *   - C1 — /tools/coupons-cashback added.
 *   - C9 — /deals/rss.xml follows the SAME pattern as the blog
 *     /rss.xml: at HEAD neither feed was listed; B6 lists the blog
 *     feed, so the deals feed is listed too. Both routes exist
 *     (app/rss.xml/route.ts, app/deals/rss.xml/route.ts). If either
 *     feed is ever delisted, delist the other one too — the two
 *     stay consistent.
 */

import type { MetadataRoute } from 'next';
import { appConfig } from '@/lib/config/app';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/config/env';
import { getAllPosts } from '@/lib/blog/posts';
import { buildTaxonomySitemapEntries } from '@/lib/brand-category-seo';
import { getLiveSessions } from '@/lib/live-sessions';
import { getTopCreators } from '@/lib/creator-storefront';
import { getAllStorePages } from '@/lib/store-directory';
import { SEARCH_TERMS } from '@/lib/search-terms';
import { withTimeout } from '@/lib/with-timeout';

/**
 * Hard bound on any single Supabase-backed sitemap section (B3).
 * A query that has not answered in 10s is treated as failed and its
 * section degrades to empty — the sitemap must never hang.
 */
const SITEMAP_QUERY_TIMEOUT_MS = 10_000;

type ChangeFrequency = NonNullable<
  MetadataRoute.Sitemap[number]['changeFrequency']
>;

const STATIC_PAGES: Array<{
  path: string;
  priority: number;
  changeFrequency: ChangeFrequency;
  /**
   * Fixed ISO date only when the last change is actually known.
   * Leave undefined (omitted) when unknown — never `new Date()`.
   */
  lastModified?: string;
}> = [
  { path: '', priority: 1.0, changeFrequency: 'daily' },
  { path: '/search', priority: 0.9, changeFrequency: 'daily' },
  { path: '/deals', priority: 0.9, changeFrequency: 'daily' },
  { path: '/compare', priority: 0.8, changeFrequency: 'weekly' },
  { path: '/gifts', priority: 0.7, changeFrequency: 'weekly' },
  { path: '/bundles', priority: 0.7, changeFrequency: 'weekly' },
  { path: '/track', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/p2p-match', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/scan', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/tools', priority: 0.7, changeFrequency: 'weekly' },
  // Section 12: the 4 Section 11 pages were missing from the
  // sitemap — nothing else in this file changes in this batch.
  { path: '/tools/help-me-choose', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/tools/budget-finder', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/tools/store-finder', priority: 0.6, changeFrequency: 'weekly' },
  // Section 13: the 4 new tools — nothing else in this file changes
  // in this chunk (another chunk adds more pages later).
  { path: '/tools/price-history', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/tools/gift-splitter', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/tools/forecast-explainer', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/tools/currency-converter', priority: 0.6, changeFrequency: 'weekly' },
  // Section 14: the 5 new tools + /products index + /partners +
  // /referrals + the two new seasonal event pages (Cyber Monday
  // 2026-11-30, Eid al-Adha 2027-05-16 expected — verified dates).
  { path: '/tools/price-alert-simulator', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/tools/deal-checker', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/tools/landed-cost', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/tools/price-protection', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/tools/emi-calculator', priority: 0.6, changeFrequency: 'weekly' },
  // Section 16: the 4 new P1 tools (E1–E4) — nothing else in this
  // file changes in this chunk (another chunk adds more pages later).
  { path: '/tools/volatility-ranking', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/tools/catalog-freshness', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/tools/api-quota-calculator', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/tools/deal-score-breakdown', priority: 0.6, changeFrequency: 'weekly' },
  // Section 16: the 6 new P2 tools (E5–E9 + E11) — another chunk
  // owns E1–E4 above. E10 adds no route (export links live on
  // /tools/price-history).
  { path: '/tools/store-trust-checker', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/tools/real-price-converter', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/tools/emi-vs-saving', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/tools/target-price-picker', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/tools/gift-occasions', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/tools/cheapest-store-by-category', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/products', priority: 0.7, changeFrequency: 'weekly' },
  { path: '/partners', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/referrals', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/events/cyber-monday', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/events/eid-al-adha', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/coming-soon', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/tools/list-optimizer', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/tools/expense-tracker', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/tools/subscription-manager', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/tools/monthly-planner', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/tools/product-qa', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/tools/savings-dashboard', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/tools/best-time-calendar', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/tools/trade-in-finder', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/tools/warranty-claim-helper', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/tools/price-drop-digest', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/tools/eco-coach', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/tools/smart-home-agent', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/tools/future-you-planner', priority: 0.6, changeFrequency: 'weekly' },
  // Section 13, Chunk E: pages that existed but were missing from
  // the sitemap. Priorities follow the existing scale (hubs 0.7,
  // indexes 0.6–0.7, utility pages 0.5).
  { path: '/pricing', priority: 0.7, changeFrequency: 'weekly' },
  { path: '/faq', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/live', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/mobile-app', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/brands', priority: 0.7, changeFrequency: 'weekly' },
  { path: '/categories', priority: 0.7, changeFrequency: 'weekly' },
  { path: '/bookmarklet', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/creators', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/warranty-plans', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/extension', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/sign-up', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/sign-in', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/events/black-friday', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/events/11-11', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/events/eid', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/events', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/help', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/methodology', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/press', priority: 0.4, changeFrequency: 'monthly' },
  { path: '/changelog', priority: 0.5, changeFrequency: 'weekly' },
  { path: '/editorial-policy', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/price-index', priority: 0.7, changeFrequency: 'weekly' },
  { path: '/platforms', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/market-reports', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/widgets', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/status', priority: 0.4, changeFrequency: 'daily' },
  { path: '/api-docs', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/sustainability', priority: 0.4, changeFrequency: 'monthly' },
  { path: '/about', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/contact', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/support', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/docs', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/privacy', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/terms', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/cookies', priority: 0.3, changeFrequency: 'yearly' },
  // Section 15: A3/A4 index pages, C1 tool, B6 feeds + embed.
  // /offline is NOT here (PWA shell, not content — B6 rejection).
  { path: '/stores', priority: 0.7, changeFrequency: 'weekly' },
  { path: '/find', priority: 0.7, changeFrequency: 'weekly' },
  { path: '/tools/coupons-cashback', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/rss.xml', priority: 0.5, changeFrequency: 'weekly' },
  { path: '/deals/rss.xml', priority: 0.5, changeFrequency: 'daily' },
  { path: '/widgets/embed', priority: 0.5, changeFrequency: 'monthly' },
];

function staticSitemap(baseUrl: string): MetadataRoute.Sitemap {
  // /blog's last change is the latest post's publish date — real data.
  const posts = getAllPosts();
  const latestPostDate = posts[0]?.datePublished;
  return [
    ...STATIC_PAGES.map((page) => ({
      url: `${baseUrl}${page.path}`,
      ...(page.lastModified
        ? { lastModified: page.lastModified }
        : {}),
      changeFrequency: page.changeFrequency,
      priority: page.priority,
    })),
    {
      url: `${baseUrl}/blog`,
      ...(latestPostDate ? { lastModified: latestPostDate } : {}),
      changeFrequency: 'weekly' as const,
      priority: 0.5,
    },
  ];
}

async function productSitemap(baseUrl: string): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [];
  try {
    const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: false },
    });

    const { data: products } = await supabase
      .from('products')
      .select('slug, updated_at')
      .is('deleted_at', null)
      // Section 14: the sample-laptop row is a DB health-check row —
      // it must never appear in the sitemap (same exclusion as
      // getProducts in services/products.ts).
      .neq('slug', 'sample-laptop')
      .order('updated_at', { ascending: false })
      .limit(500)
      // Section 15 (B3): abort a black-holed query instead of
      // hanging the whole sitemap — the catch below degrades this
      // section to empty.
      .abortSignal(AbortSignal.timeout(SITEMAP_QUERY_TIMEOUT_MS));

    if (products) {
      for (const product of products as Array<{
        slug: string;
        updated_at: string | null;
      }>) {
        entries.push({
          url: `${baseUrl}/products/${product.slug}`,
          // Real updated_at only — never fall back to "now".
          ...(product.updated_at
            ? { lastModified: product.updated_at }
            : {}),
          changeFrequency: 'weekly',
          priority: 0.7,
        });
      }
    }
  } catch {
    // If DB is unavailable, return an empty products sitemap rather
    // than failing the whole sitemap route.
  }
  return entries;
}

function blogSitemap(baseUrl: string): MetadataRoute.Sitemap {
  // Blog posts (static data file — always available, no DB needed).
  return getAllPosts().map((post) => ({
    url: `${baseUrl}/blog/${post.slug}`,
    lastModified: post.datePublished,
    changeFrequency: 'monthly' as const,
    priority: 0.6,
  }));
}

/**
 * Brand / category listing pages (Section 9, chunk 2). Slugs are
 * derived from the products table's `brand` / `category` text
 * columns only (lib/brand-category-seo.ts), so every URL listed
 * here has at least one product behind it — no invented slugs.
 * Same style as the product entries: absolute URL, weekly, 0.6,
 * no lastModified (no per-listing modification date is recorded).
 */
async function taxonomySitemap(baseUrl: string): Promise<MetadataRoute.Sitemap> {
  try {
    const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: false },
    });

    const { data: products } = await supabase
      .from('products')
      .select('brand, category')
      .is('deleted_at', null)
      // Section 14: exclude the sample-laptop health-check row, or
      // its brand ('Sample') would mint a /brands/sample URL.
      .neq('slug', 'sample-laptop')
      .limit(500)
      // Section 15 (B3): same timeout guard as productSitemap.
      .abortSignal(AbortSignal.timeout(SITEMAP_QUERY_TIMEOUT_MS));

    if (!products) return [];
    return buildTaxonomySitemapEntries(
      baseUrl,
      products as Array<{ brand: string | null; category: string | null }>
    );
  } catch {
    // If DB is unavailable, return no taxonomy entries rather than
    // failing the whole sitemap route.
    return [];
  }
}

/**
 * Live shopping session pages (Section 13, Chunk E). Same shape
 * as productSitemap: real slugs from the live_shopping_sessions
 * table via lib/live-sessions (missing table → no entries, never a
 * throw). No lastModified — the table records no modification date
 * (created_at is not one).
 */
async function liveSitemap(baseUrl: string): Promise<MetadataRoute.Sitemap> {
  try {
    const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: false },
    });
    const { sessions } = await getLiveSessions(supabase);
    return sessions.map((session) => ({
      url: `${baseUrl}/live/${session.slug}`,
      changeFrequency: 'weekly',
      priority: 0.6,
    }));
  } catch {
    return [];
  }
}

/**
 * Creator storefront pages (Section 13, Chunk E). getTopCreators
 * lists creators with a public slug and at least one verified deal
 * — exactly the creators with a /creators/[slug] page worth
 * indexing. No creators yet → no entries, which is honest.
 */
async function creatorSitemap(
  baseUrl: string
): Promise<MetadataRoute.Sitemap> {
  try {
    const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: false },
    });
    const creators = await getTopCreators(supabase, 50);
    return creators.map((creator) => ({
      url: `${baseUrl}/creators/${creator.slug}`,
      changeFrequency: 'weekly',
      priority: 0.5,
    }));
  } catch {
    return [];
  }
}

/**
 * Store directory pages (Section 15, A3). Pure registry data —
 * lib/store-directory.ts enumerates the 84 pages (80 local + 4
 * worldwide) from lib/stores.ts, so no URL here is ever invented
 * and no database is touched. No lastModified — no per-store
 * modification date is recorded.
 */
function storeSitemap(baseUrl: string): MetadataRoute.Sitemap {
  return getAllStorePages().map(({ path }) => ({
    url: `${baseUrl}${path}`,
    changeFrequency: 'weekly',
    priority: 0.6,
  }));
}

/**
 * Curated query pages (Section 15, A4). Pure curated data —
 * lib/search-terms.ts holds the 500 hand-curated queries, so every
 * /find/[query] URL here has a real page behind it (the page 404s
 * on any other slug). No database is touched. No lastModified —
 * the list changes only when a term is curated in or out.
 */
function findSitemap(baseUrl: string): MetadataRoute.Sitemap {
  return SEARCH_TERMS.map((term) => ({
    url: `${baseUrl}/find/${term.slug}`,
    changeFrequency: 'weekly',
    priority: 0.6,
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = appConfig.url;
  // Section 15 (B3): the four Supabase-backed sections run
  // CONCURRENTLY under Promise.allSettled, each waiter-bounded by
  // withTimeout(SITEMAP_QUERY_TIMEOUT_MS). A section that throws,
  // errors, or times out degrades to an empty section — it can
  // never fail or hang the whole sitemap. The static, store, find,
  // and blog sections never touch the database, so they are always
  // present even when every DB section fails open.
  const [products, taxonomy, live, creators] = await Promise.allSettled([
    withTimeout(
      productSitemap(baseUrl),
      SITEMAP_QUERY_TIMEOUT_MS,
      'product sitemap'
    ),
    withTimeout(
      taxonomySitemap(baseUrl),
      SITEMAP_QUERY_TIMEOUT_MS,
      'taxonomy sitemap'
    ),
    withTimeout(
      liveSitemap(baseUrl),
      SITEMAP_QUERY_TIMEOUT_MS,
      'live sitemap'
    ),
    withTimeout(
      creatorSitemap(baseUrl),
      SITEMAP_QUERY_TIMEOUT_MS,
      'creator sitemap'
    ),
  ]);
  const settled = (
    result: PromiseSettledResult<MetadataRoute.Sitemap>
  ): MetadataRoute.Sitemap =>
    result.status === 'fulfilled' ? result.value : [];
  return [
    ...staticSitemap(baseUrl),
    ...settled(products),
    ...settled(taxonomy),
    ...settled(live),
    ...settled(creators),
    ...storeSitemap(baseUrl),
    ...findSitemap(baseUrl),
    ...blogSitemap(baseUrl),
  ];
}
