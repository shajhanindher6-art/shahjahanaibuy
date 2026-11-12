/**
 * Section 15, W7A — sitemap consolidation (B3, B6, A3, A4, C1, C9).
 *
 * Source-text assertions for the guard and the new entries, plus a
 * REAL generation test: with the placeholder Supabase env from
 * tests/setup.ts (no database, no network) the sitemap must still
 * resolve — every Supabase-backed section fails open to empty —
 * and the result must contain exactly the static + store + find +
 * blog URLs, with zero sample-laptop and zero invented URLs.
 *
 * The generation test is slow on purpose when the sandbox
 * black-holes the placeholder host: each DB section is bounded by
 * the 10s guard, so the worst case is ~10s (all four run
 * concurrently), never a hang. Timeout is 60s for that reason.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import sitemap from '@/app/sitemap';
import { getAllStorePages } from '@/lib/store-directory';
import { SEARCH_TERMS } from '@/lib/search-terms';
import { getAllPosts } from '@/lib/blog/posts';

function readSource(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

const SITE = 'https://shahjahanaibuy-b1zp.vercel.app';

describe('sitemap timeout guard (B3)', () => {
  const text = readSource('app/sitemap.ts');

  it('bounds every Supabase query with AbortSignal.timeout(10s)', () => {
    expect(text).toContain('SITEMAP_QUERY_TIMEOUT_MS = 10_000');
    expect(text).toContain('AbortSignal.timeout(SITEMAP_QUERY_TIMEOUT_MS)');
    // Both queries owned by this file abort directly (2×).
    expect(text.match(/\.abortSignal\(AbortSignal\.timeout/g)?.length).toBe(2);
  });

  it('runs the 4 DB sections concurrently via Promise.allSettled', () => {
    expect(text).toContain('Promise.allSettled');
    expect(text).toContain('withTimeout(');
    expect(text).toContain("withTimeout(\n      productSitemap(baseUrl),");
    expect(text).toContain("withTimeout(\n      taxonomySitemap(baseUrl),");
    expect(text).toContain("withTimeout(\n      liveSitemap(baseUrl),");
    expect(text).toContain("withTimeout(\n      creatorSitemap(baseUrl),");
    // Rejected sections degrade to empty, never throw.
    expect(text).toContain(
      "result.status === 'fulfilled' ? result.value : []"
    );
  });

  it('no longer awaits the DB sections sequentially', () => {
    expect(text).not.toContain('await productSitemap(baseUrl);');
    expect(text).not.toContain('await taxonomySitemap(baseUrl);');
    expect(text).not.toContain('await liveSitemap(baseUrl);');
    expect(text).not.toContain('await creatorSitemap(baseUrl);');
  });
});

describe('sitemap additions (B6, A3, A4, C1, C9)', () => {
  const text = readSource('app/sitemap.ts');

  it('adds the B6 feeds + embed as static entries', () => {
    for (const p of ['/rss.xml', '/deals/rss.xml', '/widgets/embed']) {
      expect(text).toContain(`path: '${p}'`);
    }
  });

  it('adds the A3/A4 index pages and the C1 tool as static entries', () => {
    for (const p of ['/stores', '/find', '/tools/coupons-cashback']) {
      expect(text).toContain(`path: '${p}'`);
    }
  });

  it('keeps /offline OUT of the sitemap (PWA shell, not content)', () => {
    expect(text).not.toContain("path: '/offline'");
    expect(text).not.toContain('`${baseUrl}/offline`');
    expect(text).toContain('/offline is DELIBERATELY absent');
  });

  it('derives store pages from the registry, never hardcoded', () => {
    expect(text).toContain('getAllStorePages');
    expect(text).toContain('function storeSitemap');
    expect(text).toContain('...storeSitemap(baseUrl),');
    // No hand-written store URL anywhere in the file.
    expect(text).not.toMatch(/\/stores\/[a-z]{2}\//);
  });

  it('derives find pages from the curated terms, never hardcoded', () => {
    expect(text).toContain('SEARCH_TERMS');
    expect(text).toContain('function findSitemap');
    expect(text).toContain('`${baseUrl}/find/${term.slug}`');
    expect(text).toContain('...findSitemap(baseUrl),');
  });

  it('keeps the sample-laptop exclusion on both DB queries', () => {
    expect(text.match(/\.neq\('slug', 'sample-laptop'\)/g)?.length).toBe(2);
  });

  it('stays a single-file sitemap (no multi-file split)', () => {
    expect(text).not.toContain('generateSitemaps');
    expect(text.match(/export default async function sitemap/g)?.length).toBe(1);
  });
});

describe('sitemap registries behind the new entries', () => {
  it('store directory enumerates 84 pages with unique paths', () => {
    const pages = getAllStorePages();
    expect(pages.length).toBe(84);
    const paths = pages.map((p) => p.path);
    expect(new Set(paths).size).toBe(84);
    for (const p of ['/stores/pk/daraz', '/stores/us/ebay', '/stores/global/amazon']) {
      expect(paths).toContain(p);
    }
  });

  it('search terms are 500 curated queries with unique clean slugs', () => {
    expect(SEARCH_TERMS.length).toBe(500);
    const slugs = SEARCH_TERMS.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(500);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
    expect(slugs).toContain('macbook-air-13');
    expect(slugs).toContain('best-laptop-under-500');
  });

  it('blog posts are 21 (the sitemap blog section size)', () => {
    expect(getAllPosts().length).toBe(21);
  });
});

describe('sitemap generation fails open (B3, live behaviour)', () => {
  it(
    'resolves with static + store + find + blog URLs when the DB is unreachable',
    async () => {
      const entries = await sitemap();
      const urls = entries.map((e) => e.url);

      // Spot-check every new section is present.
      for (const u of [
        `${SITE}/stores`,
        `${SITE}/stores/pk/daraz`,
        `${SITE}/stores/us/ebay`,
        `${SITE}/stores/global/amazon`,
        `${SITE}/find`,
        `${SITE}/find/macbook-air-13`,
        `${SITE}/find/best-laptop-under-500`,
        `${SITE}/tools/coupons-cashback`,
        `${SITE}/rss.xml`,
        `${SITE}/deals/rss.xml`,
        `${SITE}/widgets/embed`,
        `${SITE}/blog`,
      ]) {
        expect(urls).toContain(u);
      }

      // Full counts per section (DB sections are empty here — the
      // placeholder host is unreachable — so these are exact).
      const storeUrls = urls.filter((u) => u.startsWith(`${SITE}/stores/`));
      expect(storeUrls.length).toBe(84);
      const findUrls = urls.filter((u) => u.startsWith(`${SITE}/find/`));
      expect(findUrls.length).toBe(500);
      const blogUrls = urls.filter((u) => u.startsWith(`${SITE}/blog/`));
      expect(blogUrls.length).toBe(21);

      // No DB-derived URL is invented when the DB is unreachable.
      expect(urls.filter((u) => /\/products\/.+/.test(u))).toEqual([]);
      expect(urls.filter((u) => /\/brands\/.+/.test(u))).toEqual([]);
      expect(urls.filter((u) => /\/categories\/.+/.test(u))).toEqual([]);
      expect(urls.filter((u) => /\/live\/.+/.test(u))).toEqual([]);
      expect(urls.filter((u) => /\/creators\/.+/.test(u))).toEqual([]);

      // Zero sample-laptop anywhere, zero duplicates, zero /offline.
      expect(urls.filter((u) => u.includes('sample-laptop'))).toEqual([]);
      expect(urls.filter((u) => u.includes('/offline'))).toEqual([]);
      expect(new Set(urls).size).toBe(urls.length);

      // Exact total: static entries (STATIC_PAGES + /blog) + blog
      // posts + store pages + find pages, all from the sources.
      const staticCount =
        readSource('app/sitemap.ts').match(/^\s*\{ path: '/gm)?.length ?? 0;
      // Section 16 added 10 tool pages (4 P1 + 6 P2 tools), so the
      // static count moved 82 -> 92; the value is asserted here so
      // a future page addition fails loudly instead of drifting.
      expect(staticCount).toBe(92);
      expect(urls.length).toBe(staticCount + 1 + 21 + 84 + 500);
    },
    60_000
  );
});
