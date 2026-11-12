import { describe, it, expect } from 'vitest';
import {
  GLOBAL_COUNTRY_SEGMENT,
  STORE_PAGE_COUNT,
  buildStoreDirectoryLinks,
  findStorePage,
  getAllStorePages,
  getStoreCountryName,
  getStorePageParams,
  groupStoresByCountry,
} from '@/lib/store-directory';
import { buildStoreSearchUrl } from '@/lib/stores';

// Section 15, A3 — /stores/[country]/[slug] directory (84 pages).
// These tests cover the pure layer (lib/store-directory.ts): page
// enumeration, country+slug resolution, the 16 links per page, and
// the index grouping. No database, no network. Every outbound URL
// asserted here is produced by the existing buildStoreSearchUrl()
// builder from the store's own verified template — nothing is
// invented in the directory code itself.

// Fixture catalog: 10 products + 6 categories, the shape the live
// catalog has today (names are fixtures, not catalog data).
const fixtureProducts = [
  { name: 'MacBook Air 13', slug: 'macbook-air-13' },
  { name: 'Galaxy S24', slug: 'galaxy-s24' },
  { name: 'Sony WH-1000XM5', slug: 'sony-wh-1000xm5' },
  { name: 'iPhone 15', slug: 'iphone-15' },
  { name: 'Dell XPS 13', slug: 'dell-xps-13' },
  { name: 'Pixel 8', slug: 'pixel-8' },
  { name: 'AirPods Pro', slug: 'airpods-pro' },
  { name: 'ThinkPad X1', slug: 'thinkpad-x1' },
  { name: 'iPad Air', slug: 'ipad-air' },
  { name: 'Bose QC45', slug: 'bose-qc45' },
];
const fixtureCategories = [
  'Laptops',
  'Smartphones',
  'Headphones',
  'Tablets',
  'Wearables',
  'Accessories',
];

describe('store page enumeration', () => {
  it('has 84 pages: 80 local + 4 worldwide', () => {
    expect(STORE_PAGE_COUNT).toBe(84);
    const pages = getAllStorePages();
    expect(pages).toHaveLength(84);
    expect(pages.filter((p) => p.country !== GLOBAL_COUNTRY_SEGMENT)).toHaveLength(80);
    expect(pages.filter((p) => p.country === GLOBAL_COUNTRY_SEGMENT)).toHaveLength(4);
  });

  it('generateStaticParams output is 84 unique (country, slug) pairs', () => {
    const params = getStorePageParams();
    expect(params).toHaveLength(84);
    const keys = new Set(params.map((p) => `${p.country}/${p.slug}`));
    expect(keys.size).toBe(84);
    for (const param of params) {
      expect(param.country).toBe(param.country.toLowerCase());
      expect(param.slug).toBeTruthy();
    }
  });

  it('every page path is /stores/<country>/<slug> and unique', () => {
    const paths = getAllStorePages().map((p) => p.path);
    expect(new Set(paths).size).toBe(84);
    for (const path of paths) {
      expect(path).toMatch(/^\/stores\/[a-z]+\/[a-z0-9-]+$/);
    }
  });

  it('every store template contains {q} so the query is substituted', () => {
    for (const { store } of getAllStorePages()) {
      expect(store.searchUrlTemplate).toContain('{q}');
    }
  });
});

describe('findStorePage', () => {
  it('resolves known local stores', () => {
    const daraz = findStorePage('pk', 'daraz');
    expect(daraz?.store.name).toBe('Daraz');
    expect(daraz?.store.websiteUrl).toBe('https://www.daraz.pk');
    expect(daraz?.path).toBe('/stores/pk/daraz');
    expect(findStorePage('us', 'walmart')?.store.name).toBe('Walmart');
  });

  it('resolves the worldwide stores under /stores/global/', () => {
    const amazon = findStorePage('global', 'amazon');
    expect(amazon?.store.name).toBe('Amazon');
    expect(amazon?.path).toBe('/stores/global/amazon');
    expect(findStorePage('global', 'google-shopping')?.store.name).toBe(
      'Google Shopping'
    );
  });

  it('is case-insensitive', () => {
    expect(findStorePage('PK', 'Daraz')?.path).toBe('/stores/pk/daraz');
    expect(findStorePage('Global', 'AMAZON')?.path).toBe('/stores/global/amazon');
  });

  it('returns null for unknown country, slug, or wrong-country slug', () => {
    expect(findStorePage('xx', 'ebay')).toBeNull();
    expect(findStorePage('pk', 'no-such-store')).toBeNull();
    // Daraz exists in PK/BD/LK/NP — not in the US.
    expect(findStorePage('us', 'daraz')).toBeNull();
    // Noon exists in AE/SA/QA/EG — not in PK.
    expect(findStorePage('pk', 'noon')).toBeNull();
    // A worldwide slug is not a local store.
    expect(findStorePage('us', 'aliexpress')).toBeNull();
    // ZA has no confirmed local store.
    expect(findStorePage('za', 'ebay')).toBeNull();
    expect(findStorePage(null, 'ebay')).toBeNull();
    expect(findStorePage('pk', null)).toBeNull();
  });

  it('keeps repeated slugs apart by country (eBay domains differ)', () => {
    const us = findStorePage('us', 'ebay');
    const gb = findStorePage('gb', 'ebay');
    expect(us?.store.websiteUrl).toBe('https://www.ebay.com');
    expect(gb?.store.websiteUrl).toBe('https://www.ebay.co.uk');
    expect(us?.path).not.toBe(gb?.path);
  });
});

describe('store directory links', () => {
  it('builds 16 links per page: 10 products + 6 categories', () => {
    const entry = findStorePage('pk', 'daraz');
    expect(entry).not.toBeNull();
    const { productLinks, categoryLinks } = buildStoreDirectoryLinks(
      entry!.store,
      fixtureProducts,
      fixtureCategories
    );
    expect(productLinks).toHaveLength(10);
    expect(categoryLinks).toHaveLength(6);
    expect(productLinks.length + categoryLinks.length).toBe(16);
  });

  it('every link is exactly the store builder output — no invented URLs', () => {
    for (const { store } of getAllStorePages()) {
      const { productLinks, categoryLinks } = buildStoreDirectoryLinks(
        store,
        fixtureProducts,
        fixtureCategories
      );
      for (const link of [...productLinks, ...categoryLinks]) {
        // The expected URL is recomputed from the store's own
        // template by the existing builder; equality means the
        // directory invented nothing.
        expect(link.searchUrl).toBe(buildStoreSearchUrl(store, link.label));
        // And the link stays on the retailer's own domain: the
        // search host is the website host or one of its subdomains
        // (e.g. search.rakuten.co.jp vs www.rakuten.co.jp,
        // lista.mercadolivre.com.br vs mercadolivre.com.br).
        const searchHost = new URL(link.searchUrl).hostname.replace(/^www\./, '');
        const siteHost = new URL(store.websiteUrl).hostname.replace(/^www\./, '');
        expect(
          searchHost === siteHost || searchHost.endsWith(`.${siteHost}`)
        ).toBe(true);
      }
    }
  });

  it('product links also point at the SmartBuy product page', () => {
    const entry = findStorePage('us', 'ebay');
    const { productLinks } = buildStoreDirectoryLinks(
      entry!.store,
      fixtureProducts,
      fixtureCategories
    );
    expect(productLinks[0]).toMatchObject({
      label: 'MacBook Air 13',
      productPath: '/products/macbook-air-13',
      searchUrl: 'https://www.ebay.com/sch/i.html?_nkw=MacBook%20Air%2013',
    });
  });

  it('honours the {slug} template (Myntra path form)', () => {
    const entry = findStorePage('in', 'myntra');
    const { productLinks } = buildStoreDirectoryLinks(entry!.store, [
      { name: 'Running Shoes', slug: 'running-shoes' },
    ], []);
    expect(productLinks[0].searchUrl).toBe(
      'https://www.myntra.com/running-shoes?rawQuery=Running%20Shoes'
    );
  });

  it('across all 84 pages the link count is 1,344', () => {
    let total = 0;
    for (const { store } of getAllStorePages()) {
      const { productLinks, categoryLinks } = buildStoreDirectoryLinks(
        store,
        fixtureProducts,
        fixtureCategories
      );
      total += productLinks.length + categoryLinks.length;
    }
    expect(total).toBe(84 * 16);
  });
});

describe('index grouping', () => {
  it('covers all 84 stores exactly once, worldwide group last', () => {
    const groups = groupStoresByCountry();
    const listed = groups.flatMap((g) => g.stores);
    expect(listed).toHaveLength(84);
    const keys = new Set(
      listed.map((s) => `${s.countryCode}/${s.slug}`)
    );
    expect(keys.size).toBe(84);
    const last = groups[groups.length - 1];
    expect(last.country).toBe(GLOBAL_COUNTRY_SEGMENT);
    expect(last.name).toBe('Worldwide');
    expect(last.stores).toHaveLength(4);
  });

  it('has no group for a country with no local store (ZA)', () => {
    const groups = groupStoresByCountry();
    expect(groups.some((g) => g.country === 'za')).toBe(false);
  });

  it('groups a multi-store country together (PK: Daraz + PriceOye)', () => {
    const groups = groupStoresByCountry();
    const pk = groups.find((g) => g.country === 'pk');
    expect(pk?.name).toBe('Pakistan');
    expect(pk?.stores.map((s) => s.slug).sort()).toEqual([
      'daraz',
      'priceoye',
    ]);
  });
});

describe('getStoreCountryName', () => {
  it('names countries and the worldwide group', () => {
    expect(getStoreCountryName('global')).toBe('Worldwide');
    expect(getStoreCountryName('pk')).toBe('Pakistan');
    expect(getStoreCountryName('GLOBAL')).toBe('Worldwide');
  });

  it('returns null for an unknown code', () => {
    expect(getStoreCountryName('xx')).toBeNull();
  });
});
