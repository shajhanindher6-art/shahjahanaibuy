/**
 * Section 16, items 13 / 14 / 16 / 17 — per-tool metadata, page-level
 * JSON-LD, embed metadata, tool BreadcrumbLists.
 *
 * The page wiring (which page carries which metadata / schema) is
 * asserted by reading the source files as text — those pages import
 * the React site header / footer, so they are not imported here
 * (same approach as the Section 13 trust-metadata tests). No
 * database, no network.
 *
 * Item 13 note: the 15 client-component tool pages cannot export
 * metadata themselves ('use client'), so each carries it in its own
 * layout.tsx — the pattern Section 13 Chunk E established. The test
 * asserts the layout in each tool folder exports metadata with the
 * right self-canonical.
 *
 * Item 14 note: the brief lists 29 routes, but the enumerated list
 * has 28 entries — all 28 are asserted here (find, compare, gifts,
 * bundles, about, methodology, changelog, market-reports,
 * price-index, platforms, partners, referrals, events, creators,
 * live, sustainability, mobile-app, coming-soon, warranty-plans,
 * bookmarklet, contact, support, docs, api-docs, track, scan,
 * p2p-match, status).
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildBreadcrumbJsonLd } from '@/lib/json-ld';

function readSource(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

const SITE = 'https://shahjahanaibuy-b1zp.vercel.app';

/** The 15 tool pages from item 13 (client components — metadata lives in layout.tsx). */
const TOOL_PAGES_13 = [
  'best-time-calendar',
  'eco-coach',
  'expense-tracker',
  'future-you-planner',
  'help-me-choose',
  'list-optimizer',
  'monthly-planner',
  'price-drop-digest',
  'product-qa',
  'savings-dashboard',
  'smart-home-agent',
  'store-finder',
  'subscription-manager',
  'trade-in-finder',
  'warranty-claim-helper',
];

/** The 28 routes from item 14. `items` = the data source the ItemList is built from. */
const ROUTES_14: Array<{
  route: string;
  name: string;
  items?: string;
}> = [
  { route: 'find/[query]', name: 'term.query', items: 'related.map' },
  { route: 'compare', name: 'Product Comparison' },
  { route: 'gifts', name: 'Gift Finder' },
  { route: 'bundles', name: 'Budget-to-Cart Allocator' },
  { route: 'about', name: 'About' },
  { route: 'methodology', name: 'How SmartBuy AI works' },
  { route: 'changelog', name: 'Changelog' },
  { route: 'market-reports', name: 'Market reports' },
  { route: 'price-index', name: 'SmartBuy Price Index' },
  { route: 'platforms', name: 'Platforms' },
  { route: 'partners', name: 'Partners' },
  { route: 'referrals', name: 'Referrals' },
  { route: 'events', name: 'Seasonal events', items: 'SEASONAL_EVENTS.map' },
  { route: 'creators', name: 'Creators', items: 'creators.map' },
  { route: 'live', name: 'Live shopping', items: 'sessions.map' },
  { route: 'sustainability', name: 'Sustainability' },
  { route: 'mobile-app', name: 'Mobile app' },
  { route: 'coming-soon', name: 'Coming soon' },
  { route: 'warranty-plans', name: 'Warranty & insurance plans' },
  { route: 'bookmarklet', name: 'Track from any store' },
  { route: 'contact', name: 'Contact Us' },
  { route: 'support', name: 'Support' },
  { route: 'docs', name: 'Documentation' },
  { route: 'api-docs', name: 'API Docs' },
  { route: 'track', name: 'Track this product' },
  { route: 'scan', name: 'Scan a Product' },
  { route: 'p2p-match', name: 'Traveler luggage matcher' },
  { route: 'status', name: 'Status' },
];

/** The 10 new Section 16 tools from item 17. */
const TOOLS_17 = [
  'api-quota-calculator',
  'catalog-freshness',
  'cheapest-store-by-category',
  'deal-score-breakdown',
  'emi-vs-saving',
  'gift-occasions',
  'real-price-converter',
  'store-trust-checker',
  'target-price-picker',
  'volatility-ranking',
];

describe('item 13 — per-tool metadata for all 15 tool pages', () => {
  it.each(TOOL_PAGES_13)(
    '%s: its layout.tsx exports metadata with the right self-canonical',
    (tool) => {
      const src = readSource(`app/tools/${tool}/layout.tsx`);
      expect(src).toContain('export const metadata');
      // The canonical is a template literal, so the backtick is part of the source.
      expect(src).toContain(`canonical: \`\${appConfig.url}/tools/${tool}\``);
      expect(src).toContain('title:');
      expect(src).toContain('description:');
      // The page itself is a client component and must NOT export metadata.
      const page = readSource(`app/tools/${tool}/page.tsx`);
      expect(page).not.toContain('export const metadata');
    }
  );
});

describe('item 14 — page-level JSON-LD for all routes', () => {
  it.each(ROUTES_14)(
    '$route: renders PageJsonLd with its own name and path',
    ({ route, name, items }) => {
      const src = readSource(`app/${route}/page.tsx`);
      // Crumb objects are written with double quotes in the new
      // pages and single quotes in older ones — normalise so the
      // assertions check structure, not quote style.
      const norm = src.replaceAll('"', "'");
      expect(src).toContain(
        "import { PageJsonLd } from '@/components/seo/page-json-ld';"
      );
      // Exactly one JSON-LD render per page (no duplicated script tags).
      expect(src.match(/<PageJsonLd/g)?.length).toBe(1);
      // Dynamic name on /find/[query] (term.query), static string elsewhere.
      expect(src).toContain(
        name.includes('.') ? `name={${name}}` : `name="${name}"`
      );
      if (route === 'find/[query]') {
        expect(src).toContain('path={`/find/${term.slug}`}');
        expect(norm).toContain("{ name: 'Find', path: '/find' }");
      } else {
        expect(src).toContain(`path="/${route}"`);
      }
      expect(src).toContain('crumbs={[');
      expect(norm).toContain("{ name: 'Home', path: '/' }");
      if (items) {
        expect(src).toContain(`items={${items}`);
      }
    }
  );

  it('find/[query]: ItemList lists only real related /find pages', () => {
    const src = readSource('app/find/[query]/page.tsx');
    expect(src).toContain(
      'items={related.map((other) => ({ name: other.query, path: `/find/${other.slug}` }))}'
    );
  });

  it('events / creators / live: ItemList lists only real pages on the index', () => {
    expect(readSource('app/events/page.tsx')).toContain(
      'items={SEASONAL_EVENTS.map((event) => ({ name: event.name, path: `/events/${event.slug}` }))}'
    );
    expect(readSource('app/creators/page.tsx')).toContain(
      "items={creators.map((creator) => ({ name: creator.displayName ?? 'Creator', path: `/creators/${creator.slug}` }))}"
    );
    expect(readSource('app/live/page.tsx')).toContain(
      'items={sessions.map((session) => ({ name: session.title, path: `/live/${session.slug}` }))}'
    );
  });

  it('the BreadcrumbList builder emits Home first, current page last with no URL', () => {
    const schema = buildBreadcrumbJsonLd(SITE, [
      { name: 'Home', path: '/' },
      { name: 'About' },
    ]);
    expect(schema['@type']).toBe('BreadcrumbList');
    const items = schema.itemListElement as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ position: 1, name: 'Home', item: `${SITE}/` });
    expect(items[1]).toMatchObject({ position: 2, name: 'About' });
    expect(items[1]).not.toHaveProperty('item');
  });
});

describe('item 16 — /widgets/embed metadata', () => {
  it('exports metadata and is noindex (an iframe embed, not a landing page)', () => {
    const src = readSource('app/widgets/embed/page.tsx');
    expect(src).toContain('export const metadata');
    expect(src).toContain('title:');
    expect(src).toContain('description:');
    expect(src).toContain('index: false');
    expect(src).toContain('follow: false');
  });
});

describe('item 17 — BreadcrumbList on the 10 new Section 16 tools', () => {
  it.each(TOOLS_17)(
    '%s: PageJsonLd with crumbs Home → AI tools → this tool',
    (tool) => {
      const src = readSource(`app/tools/${tool}/page.tsx`);
      // Quote-style normalisation (see item 14): the new tool pages
      // write crumb objects with double quotes.
      const norm = src.replaceAll('"', "'");
      expect(src).toContain(
        "import { PageJsonLd } from '@/components/seo/page-json-ld';"
      );
      expect(src.match(/<PageJsonLd/g)?.length).toBe(1);
      expect(src).toContain('crumbs={[');
      expect(norm).toContain("{ name: 'Home', path: '/' }");
      expect(norm).toContain("{ name: 'AI tools', path: '/tools' }");
      expect(src).toContain(`path="/tools/${tool}"`);
    }
  );
});
