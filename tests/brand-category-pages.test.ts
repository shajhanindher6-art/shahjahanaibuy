import { describe, it, expect } from 'vitest';
import {
  buildTaxonomyJsonLd,
  buildTaxonomyMetadata,
  buildTaxonomySitemapEntries,
  deriveTaxonomySlugs,
  matchTaxonomyName,
  resolveTaxonomyPage,
  slugify,
  type TaxonomyPageData,
  type TaxonomyProduct,
} from '@/lib/brand-category-seo';

// Section 9, chunk 2 — programmatic SEO: /brands/[slug] and
// /categories/[slug] are built from the catalog only. These tests
// cover the pure layer (lib/brand-category-seo.ts): slug derivation,
// empty-state vs 404 resolution, metadata, JSON-LD and sitemap
// entries. No database, no network.

const SITE = 'https://shahjahanaibuy-b1zp.vercel.app';

const macbook: TaxonomyProduct = {
  name: 'MacBook Air 13',
  slug: 'macbook-air-13',
  description: 'Apple MacBook Air 13 with M-series chip.',
  brand: 'Apple',
  category: 'Laptops',
};
const galaxy: TaxonomyProduct = {
  name: 'Galaxy S24',
  slug: 'galaxy-s24',
  description: null,
  brand: 'Samsung',
  category: 'Smartphones',
};
const sonyHeadphones: TaxonomyProduct = {
  name: 'Sony WH-1000XM5',
  slug: 'sony-wh-1000xm5',
  description: null,
  brand: 'Sony',
  category: 'Headphones',
};

const applePage: TaxonomyPageData = {
  kind: 'brand',
  slug: 'apple',
  name: 'Apple',
  description: null,
  products: [macbook],
};

describe('slugify', () => {
  it('lowercases and hyphenates names', () => {
    expect(slugify('Apple')).toBe('apple');
    expect(slugify('Home & Garden')).toBe('home-garden');
    expect(slugify('  Sony  WH-1000XM5 ')).toBe('sony-wh-1000xm5');
  });

  it('collapses repeated separators and trims edge hyphens', () => {
    expect(slugify('A / B -- C')).toBe('a-b-c');
    expect(slugify('---Laptops---')).toBe('laptops');
  });

  it('returns an empty slug for a name with no alphanumerics', () => {
    expect(slugify('!!!')).toBe('');
  });
});

describe('deriveTaxonomySlugs', () => {
  it('derives slugs only from the values passed in — nothing invented', () => {
    expect(
      deriveTaxonomySlugs([macbook.brand, galaxy.brand, sonyHeadphones.brand])
    ).toEqual([
      { name: 'Apple', slug: 'apple' },
      { name: 'Samsung', slug: 'samsung' },
      { name: 'Sony', slug: 'sony' },
    ]);
  });

  it('skips null and blank values', () => {
    expect(deriveTaxonomySlugs([null, '', '   ', 'Apple', null])).toEqual([
      { name: 'Apple', slug: 'apple' },
    ]);
  });

  it('dedupes names that slugify to the same slug', () => {
    expect(deriveTaxonomySlugs(['Apple', 'apple', 'APPLE'])).toEqual([
      { name: 'Apple', slug: 'apple' },
    ]);
  });

  it('returns an empty list for an empty catalog', () => {
    expect(deriveTaxonomySlugs([])).toEqual([]);
  });
});

describe('matchTaxonomyName', () => {
  it('finds the catalog value for a slug', () => {
    expect(matchTaxonomyName('laptops', ['Laptops', 'Smartphones'])).toBe(
      'Laptops'
    );
  });

  it('returns null when no catalog value matches the slug', () => {
    expect(matchTaxonomyName('tablets', ['Laptops', 'Smartphones'])).toBeNull();
  });
});

describe('resolveTaxonomyPage', () => {
  const products = [macbook, galaxy, sonyHeadphones];

  it('resolves a reference-row slug to the row name and its products', () => {
    const page = resolveTaxonomyPage({
      kind: 'brand',
      slug: 'apple',
      record: { name: 'Apple', slug: 'apple', description: 'Apple Inc.' },
      products,
    });
    expect(page?.name).toBe('Apple');
    expect(page?.description).toBe('Apple Inc.');
    expect(page?.products).toEqual([macbook]);
  });

  it('resolves a slug derivable only from product rows, with no reference row', () => {
    const page = resolveTaxonomyPage({
      kind: 'category',
      slug: 'laptops',
      record: null,
      products,
    });
    expect(page?.name).toBe('Laptops');
    expect(page?.description).toBeNull();
    expect(page?.products).toEqual([macbook]);
  });

  it('returns null (404) for a slug matching no row and no product', () => {
    expect(
      resolveTaxonomyPage({
        kind: 'brand',
        slug: 'nokia',
        record: null,
        products,
      })
    ).toBeNull();
    expect(
      resolveTaxonomyPage({
        kind: 'category',
        slug: 'tablets',
        record: null,
        products,
      })
    ).toBeNull();
  });

  it('returns an empty product list — not null — when the reference row exists but has no products (honest empty state)', () => {
    const page = resolveTaxonomyPage({
      kind: 'brand',
      slug: 'nokia',
      record: { name: 'Nokia', slug: 'nokia', description: null },
      products,
    });
    expect(page).not.toBeNull();
    expect(page?.name).toBe('Nokia');
    expect(page?.products).toEqual([]);
  });

  it('matches products when the reference name differs slightly from the URL slug', () => {
    // Reference row "Apple Inc." (slug "apple") vs product brand text
    // "Apple Inc." — the product slugifies to "apple-inc", not the
    // URL slug "apple", so the reference name is an accepted match.
    const page = resolveTaxonomyPage({
      kind: 'brand',
      slug: 'apple',
      record: { name: 'Apple Inc.', slug: 'apple', description: null },
      products: [{ ...macbook, brand: 'Apple Inc.' }],
    });
    expect(page?.name).toBe('Apple Inc.');
    expect(page?.products).toEqual([{ ...macbook, brand: 'Apple Inc.' }]);
  });

  it('never includes products from another brand or category', () => {
    const page = resolveTaxonomyPage({
      kind: 'category',
      slug: 'smartphones',
      record: null,
      products,
    });
    expect(page?.products).toEqual([galaxy]);
  });
});

describe('buildTaxonomyMetadata', () => {
  it('uses the listing name as title with a per-page canonical', () => {
    const meta = buildTaxonomyMetadata(applePage, SITE);
    // The root layout template appends " | SmartBuy AI".
    expect(meta.title).toBe('Apple products');
    expect(meta.alternates?.canonical).toBe(`${SITE}/brands/apple`);
    expect(meta.description).toContain('Apple');
    const og = meta.openGraph as { title?: string; url?: string };
    expect(og.title).toBe('Apple products — SmartBuy AI');
    expect(og.url).toBe(`${SITE}/brands/apple`);
  });

  it('uses the category path for category pages', () => {
    const meta = buildTaxonomyMetadata(
      {
        kind: 'category',
        slug: 'laptops',
        name: 'Laptops',
        description: null,
        products: [macbook],
      },
      SITE
    );
    expect(meta.alternates?.canonical).toBe(`${SITE}/categories/laptops`);
  });

  it('prefers the recorded reference-row description', () => {
    const meta = buildTaxonomyMetadata(
      { ...applePage, description: 'Apple Inc. products.' },
      SITE
    );
    expect(meta.description).toBe('Apple Inc. products.');
  });

  it('never invents a twitter handle', () => {
    const meta = buildTaxonomyMetadata(applePage, SITE);
    const twitter = meta.twitter as { site?: string; creator?: string };
    expect(twitter.site).toBeUndefined();
    expect(twitter.creator).toBeUndefined();
  });
});

describe('buildTaxonomyJsonLd', () => {
  function graph(page: TaxonomyPageData) {
    const doc = JSON.parse(buildTaxonomyJsonLd(page, SITE));
    expect(doc['@context']).toBe('https://schema.org');
    expect(Array.isArray(doc['@graph'])).toBe(true);
    return doc['@graph'] as Array<Record<string, unknown>>;
  }

  it('emits an ItemList of the real product pages plus a breadcrumb', () => {
    const nodes = graph(applePage);
    const list = nodes.find((n) => n['@type'] === 'ItemList') as {
      itemListElement?: Array<Record<string, unknown>>;
    };
    expect(list).toBeDefined();
    expect(list.itemListElement).toEqual([
      {
        '@type': 'ListItem',
        position: 1,
        name: 'MacBook Air 13',
        url: `${SITE}/products/macbook-air-13`,
      },
    ]);
    const breadcrumb = nodes.find(
      (n) => n['@type'] === 'BreadcrumbList'
    ) as { itemListElement?: Array<Record<string, unknown>> };
    expect(breadcrumb.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'Apple products' },
    ]);
  });

  it('emits no ItemList for an empty listing — no invented products', () => {
    const nodes = graph({ ...applePage, products: [] });
    expect(nodes.some((n) => n['@type'] === 'ItemList')).toBe(false);
    expect(nodes.some((n) => n['@type'] === 'BreadcrumbList')).toBe(true);
  });

  it('escapes < so a </script> in a name cannot break out of the script tag', () => {
    const out = buildTaxonomyJsonLd(
      {
        ...applePage,
        name: '</script><script>alert(1)</script>',
        products: [{ ...macbook, name: '</script>' }],
      },
      SITE
    );
    expect(out).not.toContain('</script>');
    expect(JSON.parse(out)['@graph']).toBeDefined();
  });
});

describe('buildTaxonomySitemapEntries', () => {
  it('lists brand and category URLs derived from product rows only', () => {
    const entries = buildTaxonomySitemapEntries(SITE, [
      macbook,
      galaxy,
      sonyHeadphones,
    ]);
    expect(entries).toContainEqual({
      url: `${SITE}/brands/apple`,
      changeFrequency: 'weekly',
      priority: 0.6,
    });
    expect(entries).toContainEqual({
      url: `${SITE}/brands/samsung`,
      changeFrequency: 'weekly',
      priority: 0.6,
    });
    expect(entries).toContainEqual({
      url: `${SITE}/categories/laptops`,
      changeFrequency: 'weekly',
      priority: 0.6,
    });
    expect(entries).toContainEqual({
      url: `${SITE}/categories/headphones`,
      changeFrequency: 'weekly',
      priority: 0.6,
    });
    expect(entries).toHaveLength(6);
  });

  it('skips null brand/category values and dedupes repeated ones', () => {
    const entries = buildTaxonomySitemapEntries(SITE, [
      { brand: macbook.brand, category: macbook.category },
      { brand: macbook.brand, category: macbook.category },
      { brand: null, category: null },
    ]);
    expect(entries).toEqual([
      {
        url: `${SITE}/brands/apple`,
        changeFrequency: 'weekly',
        priority: 0.6,
      },
      {
        url: `${SITE}/categories/laptops`,
        changeFrequency: 'weekly',
        priority: 0.6,
      },
    ]);
  });

  it('returns no entries for an empty catalog', () => {
    expect(buildTaxonomySitemapEntries(SITE, [])).toEqual([]);
  });
});
