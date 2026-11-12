/**
 * Section 15, worker W6D — polish bundle (C5, C9, C10, C11, C12).
 *
 * Static assertions in the repo's existing style (read the source,
 * assert on it — same as tests/section13-pwa-i18n.test.ts). Nothing
 * here renders a page or calls a live service. The deals RSS route
 * is asserted statically because importing it would pull in the
 * Supabase server client.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = (...parts: string[]) => join(process.cwd(), ...parts);
const read = (rel: string) => readFileSync(root(rel), 'utf8');

describe('C5 — CategoryInflation wired into /price-index', () => {
  it('price-index page imports and renders the component', () => {
    const page = read('app/price-index/page.tsx');
    expect(page).toContain(
      "import { CategoryInflation } from '@/components/category-inflation'"
    );
    expect(page).toContain('<CategoryInflation');
  });

  it('the component still self-fetches live /api/v1/category-inflation', () => {
    const component = read('components/category-inflation.tsx');
    expect(component).toContain("fetch('/api/v1/category-inflation'");
    expect(component).toContain('Category Inflation Index');
  });
});

describe('C9 — deals RSS feed', () => {
  const route = read('app/deals/rss.xml/route.ts');

  it('exists, is force-dynamic, and returns RSS 2.0', () => {
    expect(existsSync(root('app/deals/rss.xml/route.ts'))).toBe(true);
    expect(route).toContain("export const dynamic = 'force-dynamic'");
    expect(route).toContain('<rss version="2.0">');
    expect(route).toContain('application/rss+xml');
  });

  it('uses the same ranked-deals source as /api/v1/deals/ranked, not invented deals', () => {
    expect(route).toContain('getCachedRankedDeals');
    expect(route).toContain('createSupabaseServerClient');
  });

  it('has an honest empty channel (valid RSS, zero items) instead of a 500', () => {
    expect(route).toContain('catch');
    expect(route).toContain('zero');
  });

  it('escapes XML and links items to product pages first', () => {
    expect(route).toContain('escapeXml');
    expect(route).toContain('/products/${ranked.product.slug}');
  });

  it('is linked from the deals page', () => {
    const page = read('app/deals/page.tsx');
    expect(page).toContain('/deals/rss.xml');
    expect(page).toContain('Deals RSS feed');
  });
});

describe('C10 — per-section Open Graph images', () => {
  const sections: Array<{ dir: string; title: string }> = [
    { dir: 'app/tools', title: 'Tools' },
    { dir: 'app/deals', title: 'Deals' },
    { dir: 'app/pricing', title: 'Pricing' },
    { dir: 'app/brands', title: 'Brands' },
    { dir: 'app/categories', title: 'Categories' },
  ];

  it('one opengraph-image.tsx exists per section', () => {
    for (const { dir } of sections) {
      expect(existsSync(root(dir, 'opengraph-image.tsx'))).toBe(true);
    }
  });

  it('each follows the root pattern: ImageResponse, 1200x630, image/png, own alt', () => {
    for (const { dir, title } of sections) {
      const src = read(`${dir}/opengraph-image.tsx`);
      expect(src).toContain('ImageResponse');
      expect(src).toContain('width: 1200');
      expect(src).toContain('height: 630');
      expect(src).toContain("contentType = 'image/png'");
      expect(src).toContain(title);
      expect(src).toContain('SMARTBUY AI');
    }
  });

  it('the five images are distinct (different alt text each)', () => {
    const alts = sections.map((s) => {
      const m = read(`${s.dir}/opengraph-image.tsx`).match(
        /export const alt = '([^']+)'/
      );
      expect(m).not.toBeNull();
      return m![1];
    });
    expect(new Set(alts).size).toBe(sections.length);
  });
});

describe('C11 — llms-full.txt', () => {
  it('exists as a static file next to llms.txt and is much fuller', () => {
    expect(existsSync(root('public/llms-full.txt'))).toBe(true);
    const full = read('public/llms-full.txt');
    const short = read('public/llms.txt');
    expect(full.split('\n').length).toBeGreaterThan(
      short.split('\n').length * 3
    );
    expect(full).toContain('llms.txt');
    expect(full).toContain('/sitemap.xml');
    expect(full).toContain('/deals/rss.xml');
  });

  it('lists every tool directory that exists on disk', () => {
    const full = read('public/llms-full.txt');
    const tools = readdirSync(root('app/tools'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    expect(tools.length).toBeGreaterThanOrEqual(25);
    for (const tool of tools) {
      expect(full).toContain(`/tools/${tool}`);
    }
  });

  it('lists every blog post and carries the same honest notes as llms.txt', () => {
    const full = read('public/llms-full.txt');
    expect(full).toContain('how-to-spot-a-fake-sale');
    expect(full).toContain('demo/seed prices');
    expect(full).toContain('No fake reviews');
    expect(full).toContain('20 languages');
    expect(full).toContain('61 regions');
  });
});

describe('C12 — PWA precache widening (smartbuy-v4)', () => {
  const sw = read('public/sw.js');

  it('is versioned smartbuy-v4 and precaches the four browse hubs', () => {
    expect(sw).toContain("CACHE_VERSION = 'smartbuy-v4'");
    for (const route of ['/products', '/brands', '/categories', '/blog']) {
      expect(sw).toContain(`'${route}'`);
    }
  });

  it('keeps per-asset precache and the old routes', () => {
    expect(sw).not.toContain('cache.addAll');
    for (const route of ['/', '/search', '/compare', '/deals', '/tools', '/pricing']) {
      expect(sw).toContain(`'${route}'`);
    }
  });

  it('docs/pwa.md matches v4 and states the honest offline scope', () => {
    const docs = read('docs/pwa.md');
    expect(docs).toContain('smartbuy-v4');
    expect(docs).toContain('/products');
    expect(docs).toContain('network-first');
    expect(docs).toContain('NOT visited yet');
  });
});

describe('C13 — next/image for product gallery: DROPPED (data-gated)', () => {
  it('documents why: imageUrl is null on all products and gallery hosts are outside remotePatterns', () => {
    // Product images come from arbitrary merchant hosts; the
    // gallery header says so explicitly, and next.config.js only
    // allowlists Unsplash/Pexels. next/image without `unoptimized`
    // would reject those hosts at runtime; with `unoptimized` it
    // buys nothing over the raw <img> already there. Until intake
    // supplies real image URLs (imageUrl is null on all products
    // today) the migration is zero-value churn, so it was dropped.
    const gallery = read('components/products/product-gallery.tsx');
    expect(gallery).toContain('Raw <img>, not next/image');
    const config = read('next.config.js');
    expect(config).toContain('images.unsplash.com');
    expect(config).not.toContain("hostname: '**'");
    expect(config).not.toContain("hostname: '*'");
  });
});
