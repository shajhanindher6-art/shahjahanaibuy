/**
 * Section 13, Chunk E — metadata / JSON-LD / sitemap / llms.txt tests.
 *
 * The two new JSON-LD builders are tested as pure modules. The
 * page wiring (which page carries which metadata / schema) is
 * asserted by reading the source files as text — those pages import
 * the React site header / footer, so they are not imported here
 * (same approach as the Section 12 trust tests). No database, no
 * network.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  buildEventJsonLd,
  buildSoftwareApplicationJsonLd,
} from '@/lib/json-ld';
import extensionManifest from '@/extension/manifest.json';

function readSource(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

function exists(rel: string): boolean {
  return fs.existsSync(path.join(process.cwd(), rel));
}

const SITE = 'https://shahjahanaibuy-b1zp.vercel.app';

describe('buildEventJsonLd (item 37)', () => {
  const base = {
    slug: 'black-friday',
    name: 'Black Friday 2026',
    description: 'The biggest shopping day of the year.',
    startsAt: '2026-11-27T00:00:00Z',
  };

  it('confirmed date: includes startDate and the event URL', () => {
    const schema = buildEventJsonLd(SITE, base);
    expect(schema['@type']).toBe('Event');
    expect(schema.name).toBe('Black Friday 2026');
    expect(schema.description).toBe('The biggest shopping day of the year.');
    expect(schema.url).toBe(`${SITE}/events/black-friday`);
    expect(schema.startDate).toBe('2026-11-27T00:00:00Z');
  });

  it('expected date (Eid, moon sighting): omits startDate rather than asserting a day that may move', () => {
    const schema = buildEventJsonLd(SITE, {
      ...base,
      slug: 'eid',
      name: 'Eid Sale',
      dateExpected: true,
    });
    expect(schema.url).toBe(`${SITE}/events/eid`);
    expect(schema).not.toHaveProperty('startDate');
  });

  it('never claims a location for a sale spread across retailers', () => {
    const schema = buildEventJsonLd(SITE, base);
    expect(schema).not.toHaveProperty('location');
  });
});

describe('buildSoftwareApplicationJsonLd (item 37)', () => {
  it('manifest facts: name, description, version, guide-page URL', () => {
    const schema = buildSoftwareApplicationJsonLd(SITE, {
      name: extensionManifest.name,
      description: extensionManifest.description,
      version: extensionManifest.version,
      pagePath: '/extension',
    });
    expect(schema['@type']).toBe('SoftwareApplication');
    expect(schema.name).toBe('SmartBuy AI — Price Comparison & Coupons');
    expect(schema.softwareVersion).toBe('2.0.0');
    expect(schema.url).toBe(`${SITE}/extension`);
    expect(schema.applicationCategory).toBe('BrowserApplication');
  });

  it('claims no store listing, install URL, or price — none is recorded', () => {
    const schema = buildSoftwareApplicationJsonLd(SITE, {
      name: 'SmartBuy AI — Price Comparison & Coupons',
      description: 'Find better prices while you shop.',
      version: '2.0.0',
      pagePath: '/extension',
    });
    expect(schema).not.toHaveProperty('offers');
    expect(schema).not.toHaveProperty('installUrl');
    expect(schema).not.toHaveProperty('operatingSystem');
  });

  it('the manifest the schema reads is v2.0.0', () => {
    expect(extensionManifest.version).toBe('2.0.0');
    expect(extensionManifest.name).toContain('SmartBuy AI');
  });
});

describe('metadata pack (item 36) — every target page has exactly one metadata source', () => {
  // New layout.tsx wrappers (client pages + tools hub): each carries
  // one metadata export with a self-canonical URL.
  const LAYOUTS: Array<{ file: string; path: string }> = [
    { file: 'app/tools/layout.tsx', path: '/tools' },
    { file: 'app/tools/list-optimizer/layout.tsx', path: '/tools/list-optimizer' },
    { file: 'app/tools/expense-tracker/layout.tsx', path: '/tools/expense-tracker' },
    { file: 'app/tools/subscription-manager/layout.tsx', path: '/tools/subscription-manager' },
    { file: 'app/tools/monthly-planner/layout.tsx', path: '/tools/monthly-planner' },
    { file: 'app/tools/product-qa/layout.tsx', path: '/tools/product-qa' },
    { file: 'app/tools/savings-dashboard/layout.tsx', path: '/tools/savings-dashboard' },
    { file: 'app/tools/best-time-calendar/layout.tsx', path: '/tools/best-time-calendar' },
    { file: 'app/tools/trade-in-finder/layout.tsx', path: '/tools/trade-in-finder' },
    { file: 'app/tools/warranty-claim-helper/layout.tsx', path: '/tools/warranty-claim-helper' },
    { file: 'app/tools/price-drop-digest/layout.tsx', path: '/tools/price-drop-digest' },
    { file: 'app/tools/eco-coach/layout.tsx', path: '/tools/eco-coach' },
    { file: 'app/tools/smart-home-agent/layout.tsx', path: '/tools/smart-home-agent' },
    { file: 'app/tools/future-you-planner/layout.tsx', path: '/tools/future-you-planner' },
    { file: 'app/search/layout.tsx', path: '/search' },
    { file: 'app/deals/layout.tsx', path: '/deals' },
    { file: 'app/compare/layout.tsx', path: '/compare' },
    { file: 'app/gifts/layout.tsx', path: '/gifts' },
    { file: 'app/bundles/layout.tsx', path: '/bundles' },
    { file: 'app/scan/layout.tsx', path: '/scan' },
    { file: 'app/market-reports/layout.tsx', path: '/market-reports' },
    { file: 'app/blog/layout.tsx', path: '/blog' },
    { file: 'app/price-index/layout.tsx', path: '/price-index' },
    { file: 'app/track/layout.tsx', path: '/track' },
    { file: 'app/bookmarklet/layout.tsx', path: '/bookmarklet' },
    { file: 'app/warranty-plans/layout.tsx', path: '/warranty-plans' },
    { file: 'app/offline/layout.tsx', path: '/offline' },
  ];

  it('all 27 new layouts exist, export metadata once, and self-canonicalize', () => {
    expect(LAYOUTS).toHaveLength(27);
    for (const { file, path: pagePath } of LAYOUTS) {
      expect(exists(file), `${file} should exist`).toBe(true);
      const text = readSource(file);
      expect(text.match(/export const metadata/g)?.length).toBe(1);
      expect(text).toContain('SmartBuy AI');
      expect(text).toContain('canonical:');
      expect(text).toContain(`\`${'${appConfig.url}'}${pagePath}\``);
      expect(text).toContain('openGraph');
    }
  });

  // Server pages: metadata exported directly in the page file.
  const SERVER_PAGES: Array<{ file: string; path: string }> = [
    { file: 'app/mobile-app/page.tsx', path: '/mobile-app' },
    { file: 'app/extension/page.tsx', path: '/extension' },
    { file: 'app/live/page.tsx', path: '/live' },
    { file: 'app/events/page.tsx', path: '/events' },
    { file: 'app/p2p-match/page.tsx', path: '/p2p-match' },
    { file: 'app/sustainability/page.tsx', path: '/sustainability' },
    { file: 'app/creators/page.tsx', path: '/creators' },
    { file: 'app/widgets/page.tsx', path: '/widgets' },
  ];

  it('all 8 server pages export metadata once with a self-canonical URL', () => {
    for (const { file, path: pagePath } of SERVER_PAGES) {
      const text = readSource(file);
      expect(text.match(/export const metadata/g)?.length).toBe(1);
      expect(text).toContain('SmartBuy AI');
      expect(text).toContain(`\`${'${appConfig.url}'}${pagePath}\``);
    }
  });

  it('events/[slug] uses generateMetadata per event (no static export)', () => {
    const text = readSource('app/events/[slug]/page.tsx');
    expect(text).toContain('export async function generateMetadata');
    expect(text).toContain('getEventBySlug(params.slug)');
    expect(text).toContain('/events/${event.slug}');
    expect(text.match(/export const metadata/g)?.length ?? 0).toBe(0);
  });

  it('pages that already had metadata were NOT duplicated', () => {
    // budget-finder (server export) got no layout wrapper.
    expect(exists('app/tools/budget-finder/layout.tsx')).toBe(false);
    expect(readSource('app/tools/budget-finder/page.tsx').match(/export const metadata/g)?.length).toBe(1);
    // help-me-choose / store-finder keep their Section 12 layouts.
    for (const tool of ['help-me-choose', 'store-finder']) {
      const text = readSource(`app/tools/${tool}/layout.tsx`);
      expect(text.match(/export const metadata/g)?.length).toBe(1);
    }
    // Wave 1 tools keep their own page-level metadata, no wrapper.
    for (const tool of ['price-history', 'gift-splitter', 'forecast-explainer', 'currency-converter']) {
      expect(exists(`app/tools/${tool}/layout.tsx`)).toBe(false);
      expect(readSource(`app/tools/${tool}/page.tsx`).match(/export const metadata/g)?.length).toBe(1);
    }
  });

  it('no metadata was added to files outside this chunk', () => {
    // app/tools/page.tsx is owned by another chunk this wave.
    expect(readSource('app/tools/page.tsx')).not.toContain('export const metadata');
  });
});

describe('JSON-LD pack wiring (item 37)', () => {
  it('events/[slug] renders the Event schema from the recorded event', () => {
    const text = readSource('app/events/[slug]/page.tsx');
    expect(text).toContain('buildEventJsonLd(appConfig.url, event)');
    expect(text).toContain('type="application/ld+json"');
  });

  it('extension renders SoftwareApplication from the manifest import', () => {
    const text = readSource('app/extension/page.tsx');
    expect(text).toContain("import extensionManifest from '@/extension/manifest.json'");
    expect(text).toContain('buildSoftwareApplicationJsonLd(appConfig.url, {');
    expect(text).toContain('extensionManifest.version');
    expect(text).toContain('type="application/ld+json"');
  });

  it('brands / categories indexes render an ItemList of their real listing URLs', () => {
    const brands = readSource('app/brands/page.tsx');
    expect(brands).toContain('buildItemListJsonLd(');
    expect(brands).toContain('`/brands/${brand.slug}`');
    const categories = readSource('app/categories/page.tsx');
    expect(categories).toContain('buildItemListJsonLd(');
    expect(categories).toContain('`/categories/${category.slug}`');
  });

  it('blog index renders an ItemList of its real post URLs', () => {
    const text = readSource('app/blog/page.tsx');
    expect(text).toContain('buildItemListJsonLd(');
    expect(text).toContain('`/blog/${post.slug}`');
  });

  it('deals renders an ItemList of product-linked deals only, deduped by slug', () => {
    const text = readSource('app/deals/page.tsx');
    expect(text).toContain('dealsItemListJsonLd');
    expect(text).toContain('if (!deal.product) continue;');
    expect(text).toContain('if (seen.has(deal.product.slug)) continue;');
    expect(text).toContain('`/products/${deal.product.slug}`');
  });
});

describe('sitemap completion (item 38)', () => {
  const text = readSource('app/sitemap.ts');

  it('lists the 9 previously missing static pages', () => {
    for (const p of [
      '/pricing',
      '/faq',
      '/live',
      '/mobile-app',
      '/brands',
      '/categories',
      '/bookmarklet',
      '/creators',
      '/warranty-plans',
    ]) {
      expect(text).toContain(`path: '${p}'`);
    }
  });

  it('adds live + creator dynamic entries mirroring productSitemap', () => {
    expect(text).toContain('async function liveSitemap');
    expect(text).toContain('getLiveSessions(supabase)');
    expect(text).toContain('/live/${session.slug}');
    expect(text).toContain('async function creatorSitemap');
    expect(text).toContain('getTopCreators(supabase, 50)');
    expect(text).toContain('/creators/${creator.slug}');
    expect(text).toContain('...live,');
    expect(text).toContain('...creators,');
  });

  it('still lists the 4 Wave 1 tool paths (those lines untouched)', () => {
    for (const p of [
      '/tools/price-history',
      '/tools/gift-splitter',
      '/tools/forecast-explainer',
      '/tools/currency-converter',
    ]) {
      expect(text).toContain(`path: '${p}'`);
    }
  });

  it('stays a single-file sitemap (no multi-file split)', () => {
    // No generateSitemaps export and exactly one default sitemap
    // function. (__metadata_id__ appears in the header comment that
    // documents WHY the split was reverted — that mention is the
    // warning, not a split.)
    expect(text).not.toContain('generateSitemaps');
    expect(text.match(/export default async function sitemap/g)?.length).toBe(1);
  });
});

describe('llms.txt refresh (item 39)', () => {
  const llms = readSource('public/llms.txt');

  it('adds the missing key pages', () => {
    for (const p of ['/tools', '/pricing', '/brands', '/categories', '/coming-soon', '/compare']) {
      expect(llms).toContain(`shahjahanaibuy-b1zp.vercel.app${p}`);
    }
  });

  it('qualifies the 20-languages claim honestly', () => {
    expect(llms).toMatch(/20 languages/i);
    expect(llms).toContain('28 chrome strings');
    expect(llms).toContain('12 of the 20 languages are machine-translated');
    expect(llms).toContain('all other content');
    expect(llms).toMatch(/61 regions/i);
  });

  it('keeps the existing pages and honesty notes', () => {
    for (const p of ['/blog', '/search', '/deals', '/gifts', '/scan', '/privacy', '/terms']) {
      expect(llms).toContain(p);
    }
    expect(llms).toContain('demo/seed prices');
    expect(llms).toContain('/sitemap.xml');
  });
});
