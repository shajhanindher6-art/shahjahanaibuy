/**
 * Section 12, Chunk A — trust sweep tests.
 *
 * Methodology / billing / press copy is asserted by reading the
 * source files as text (those pages import the React site header /
 * footer, so they are not imported here). Changelog, taxonomy and
 * i18n assertions use the pure modules directly. No database, no
 * network.
 *
 * Deliberately NOT asserted here: exact vitest counts as a fixed
 * number. The press page carries the final Section 12 full-run
 * totals (122 files / 1,370 tests); one test below asserts that
 * exact string, so it must be updated together with the press page
 * whenever the suite grows.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { RELEASES } from '@/app/changelog/releases';
import {
  deriveTaxonomySlugs,
  resolveTaxonomyPage,
  type TaxonomyProduct,
} from '@/lib/brand-category-seo';
import { DICTIONARIES, tFor, type DictKey } from '@/lib/i18n';
import { SUPPORTED_LANGUAGES } from '@/lib/region';

function readSource(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

const NEW_NAV_KEYS: DictKey[] = [
  'navTools',
  'navSearch',
  'navDeals',
  'navCompare',
  'navBrands',
];

describe('methodology — no false live affiliate-tag claim', () => {
  const text = readSource('app/methodology/page.tsx');

  it('never names a live affiliate tag', () => {
    expect(text).not.toContain('smartbuy-20');
    expect(text).not.toMatch(/live affiliate tag/i);
  });

  it('states honestly that no affiliate tag is configured', () => {
    expect(text).toMatch(/No affiliate tag is currently configured/);
    expect(text).not.toMatch(/invent a different tag|another tag/i);
  });
});

describe('billing — honest tier names, history span, alerts, test mode', () => {
  const text = readSource('app/dashboard/billing/page.tsx');

  it('has no "1-year price history" claim', () => {
    expect(text).not.toContain('1-year');
    expect(text).toMatch(/currently up to 30 days/);
  });

  it('calls the paid tier Premium, never Pro', () => {
    // \bPro\b so "Product details" / "Priority support" do not
    // false-positive — only the standalone tier name is banned.
    expect(text).not.toMatch(/\bPro\b/);
    expect(text).not.toContain('Upgrade to Pro');
    expect(text).not.toContain('Pro Plan');
    expect(text).toContain('Premium');
    expect(text).toContain('Upgrade to Premium');
  });

  it('uses lib/tiers.ts as canonical for Free alerts (5, not 3)', () => {
    expect(text).toContain('Up to 5 price alerts');
    expect(text).not.toContain('3 max');
  });

  it('says payments are in test mode', () => {
    expect(text).toMatch(/test mode/i);
    expect(text).toMatch(/Stripe is not live yet/);
  });
});

describe('press — refreshed counts, relative dates, qualified languages', () => {
  const text = readSource('app/press/page.tsx');

  it('carries the final Section 12 full-run counts (marker removed after finalizing)', () => {
    expect(text).not.toContain('SECTION12-FINAL-COUNTS');
    expect(text).toContain('1,370 passing (122 test files, full run 11 November 2026)');
  });

  it('has no hardcoded price-history calendar span', () => {
    expect(text).not.toContain('October 3');
    expect(text).not.toContain('November 2, 2026');
    expect(text).toMatch(/30 days before the catalog was seeded/);
  });

  it('qualifies "20 languages" honestly', () => {
    expect(text).toMatch(/only 28 interface strings translated/);
    expect(text).toMatch(/machine-translated/);
    expect(text).toMatch(/stays English/);
    expect(text).not.toContain('20 (English, Urdu, German');
  });

  it('keeps the fact-sheet structure (labels, not exact test counts)', () => {
    expect(text).toContain('Automated tests passing');
    expect(text).toContain('Recorded price history span');
    expect(text).toContain('Languages');
  });
});

describe('changelog — Sections 8–11 entries', () => {
  it('lists Section 8, 9, 10 and 11 with real dates and full SHAs', () => {
    for (const section of [8, 9, 10, 11]) {
      const entry = RELEASES.find((r) =>
        r.title.startsWith(`Section ${section}:`)
      );
      expect(entry, `Section ${section} entry`).toBeDefined();
      expect(entry!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry!.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(entry!.paths.length).toBeGreaterThan(0);
    }
  });

  it('dates the sections on their real days', () => {
    const bySection = new Map(
      RELEASES.filter((r) => r.title.startsWith('Section'))
        .map((r) => [r.title.split(':')[0], r.date])
    );
    expect(bySection.get('Section 8')).toBe('2026-11-10');
    expect(bySection.get('Section 9')).toBe('2026-11-10');
    expect(bySection.get('Section 10')).toBe('2026-11-11');
    expect(bySection.get('Section 11')).toBe('2026-11-11');
  });

  it('names the real content of each section', () => {
    const titles = RELEASES.map((r) => r.title).join('\n');
    expect(titles).toMatch(/80 stores, 61 regions/);
    expect(titles).toMatch(/catalog intake pipeline/);
    expect(titles).toMatch(/public API paywall/);
    expect(titles).toMatch(/Guided Quiz/);
    expect(titles).toMatch(/Budget Finder/);
    expect(titles).toMatch(/Store Finder/);
    expect(titles).toMatch(/Coming-soon/);
  });
});

describe('sitemap — the 4 Section 11 pages are listed', () => {
  const text = readSource('app/sitemap.ts');

  it('lists all four Section 11 pages and nothing else was added here', () => {
    for (const p of [
      '/tools/help-me-choose',
      '/tools/budget-finder',
      '/tools/store-finder',
      '/coming-soon',
    ]) {
      expect(text).toContain(`path: '${p}'`);
    }
  });
});

describe('brands / categories index — data resolves to real listing pages', () => {
  const products: TaxonomyProduct[] = [
    {
      name: 'MacBook Air 13',
      slug: 'macbook-air-13',
      description: null,
      brand: 'Apple',
      category: 'Laptops',
    },
    {
      name: 'Galaxy S24',
      slug: 'galaxy-s24',
      description: null,
      brand: 'Samsung',
      category: 'Smartphones',
    },
  ];

  it('derives brand and category slugs from product rows only', () => {
    expect(deriveTaxonomySlugs(products.map((p) => p.brand))).toEqual([
      { name: 'Apple', slug: 'apple' },
      { name: 'Samsung', slug: 'samsung' },
    ]);
    expect(deriveTaxonomySlugs(products.map((p) => p.category))).toEqual([
      { name: 'Laptops', slug: 'laptops' },
      { name: 'Smartphones', slug: 'smartphones' },
    ]);
  });

  it('every derived slug resolves to a listing page (no dead index link)', () => {
    for (const brand of deriveTaxonomySlugs(products.map((p) => p.brand))) {
      const page = resolveTaxonomyPage({
        kind: 'brand',
        slug: brand.slug,
        record: null,
        products,
      });
      expect(page).not.toBeNull();
      expect(page!.name).toBe(brand.name);
    }
    for (const category of deriveTaxonomySlugs(
      products.map((p) => p.category)
    )) {
      const page = resolveTaxonomyPage({
        kind: 'category',
        slug: category.slug,
        record: null,
        products,
      });
      expect(page).not.toBeNull();
      expect(page!.name).toBe(category.name);
    }
  });

  it('the index pages link to each listing and carry an honest empty state', () => {
    const brands = readSource('app/brands/page.tsx');
    const categories = readSource('app/categories/page.tsx');
    expect(brands).toContain('href={`/brands/${brand.slug}`}');
    expect(brands).toContain('No brands in the catalog yet');
    expect(categories).toContain('href={`/categories/${category.slug}`}');
    expect(categories).toContain('No categories in the catalog yet');
  });
});

describe('i18n — the 5 new nav keys exist in all 20 languages', () => {
  it('defines navTools / navSearch / navDeals / navCompare / navBrands everywhere', () => {
    expect(SUPPORTED_LANGUAGES).toHaveLength(20);
    for (const lang of SUPPORTED_LANGUAGES) {
      for (const key of NEW_NAV_KEYS) {
        const value = DICTIONARIES[lang][key];
        expect(typeof value, `${lang}.${key}`).toBe('string');
        expect(value.length, `${lang}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('tFor returns the new keys (English spot-check)', () => {
    expect(tFor('en', 'navTools')).toBe('Tools');
    expect(tFor('en', 'navSearch')).toBe('Search');
    expect(tFor('en', 'navDeals')).toBe('Deals');
    expect(tFor('en', 'navCompare')).toBe('Compare');
    expect(tFor('en', 'navBrands')).toBe('Brands');
    expect(tFor('de', 'navSearch')).toBe('Suche');
  });

  it('the header uses the new keys (and the /brands index, not #browse)', () => {
    const header = readSource('components/layout/site-header.tsx');
    for (const key of NEW_NAV_KEYS) {
      expect(header).toContain(key);
    }
    expect(header).toContain("tFor(language, 'navTools')");
    expect(header).toContain("href: '/brands'");
    expect(header).not.toContain("href: '/#browse'");
  });
});

describe('tool metadata layouts — SmartBuy AI brand suffix', () => {
  it('help-me-choose and store-finder layouts carry metadata + canonical', () => {
    for (const [file, slug] of [
      ['app/tools/help-me-choose/layout.tsx', '/tools/help-me-choose'],
      ['app/tools/store-finder/layout.tsx', '/tools/store-finder'],
    ] as const) {
      const text = readSource(file);
      expect(text).toContain('export const metadata');
      expect(text).toContain('— SmartBuy AI');
      // No bare "SmartBuy" suffix without "AI" (e.g. budget-finder's
      // older '— SmartBuy' title is not the pattern here).
      expect(text).not.toMatch(/— SmartBuy['",\n]/);
      expect(text).toContain(slug);
      expect(text).toContain('canonical');
    }
  });
});
