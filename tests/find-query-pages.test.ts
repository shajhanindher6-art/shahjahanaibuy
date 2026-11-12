import { describe, it, expect } from 'vitest';
import {
  ALL_FIND_STORES,
  SEARCH_TERMS,
  SEARCH_TERM_CATEGORIES,
  getFindLinkInstanceTotal,
  getFindQueryStoreLinks,
  getSearchTermBySlug,
  getSearchTermCategoryCounts,
  getSearchTermsByCategory,
  searchTermSlug,
} from '@/lib/search-terms';
import { GLOBAL_STORES, LOCAL_STORES } from '@/lib/stores';

// Section 15, A4 — curated query pages /find/[query] + /find.
// These tests cover the pure layer (lib/search-terms.ts): the 500
// curated terms, slug resolution (known -> term, unknown -> null),
// and the store search links. No database, no network. The pages
// themselves render from these helpers (generateStaticParams over
// SEARCH_TERMS; unknown slug -> notFound()).

describe('SEARCH_TERMS curation', () => {
  it('has exactly 500 curated queries', () => {
    expect(SEARCH_TERMS.length).toBe(500);
  });

  it('every query is non-empty, trimmed, and plausible text', () => {
    for (const term of SEARCH_TERMS) {
      expect(term.query.length).toBeGreaterThan(0);
      expect(term.query).toBe(term.query.trim());
      // No placeholders, URLs, or template junk in a query.
      expect(term.query).not.toContain('{');
      expect(term.query).not.toContain('}');
      expect(term.query).not.toContain('http');
      // Queries are lower-case plain text (brands/models as typed).
      expect(term.query).toBe(term.query.toLowerCase());
    }
  });

  it('all queries are unique (exact and case-insensitive)', () => {
    const lowered = SEARCH_TERMS.map((term) => term.query.toLowerCase());
    expect(new Set(lowered).size).toBe(SEARCH_TERMS.length);
  });

  it('all slugs are unique, URL-safe, and derived from the query', () => {
    const slugs = SEARCH_TERMS.map((term) => term.slug);
    expect(new Set(slugs).size).toBe(SEARCH_TERMS.length);
    for (const term of SEARCH_TERMS) {
      expect(term.slug).toBe(searchTermSlug(term.query));
      expect(term.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('every term belongs to a known category', () => {
    for (const term of SEARCH_TERMS) {
      expect(SEARCH_TERM_CATEGORIES).toContain(term.category);
    }
    for (const category of SEARCH_TERM_CATEGORIES) {
      expect(getSearchTermsByCategory(category).length).toBeGreaterThan(0);
    }
  });

  it('per-category counts sum to 500', () => {
    const counts = getSearchTermCategoryCounts();
    expect(counts.map((entry) => entry.category)).toEqual(
      SEARCH_TERM_CATEGORIES
    );
    expect(
      counts.reduce((total, entry) => total + entry.count, 0)
    ).toBe(500);
    expect(Object.fromEntries(counts.map((c) => [c.category, c.count]))).toEqual({
      Laptops: 60,
      Smartphones: 60,
      'Headphones & Audio': 50,
      'TVs & Home Entertainment': 40,
      Cameras: 30,
      Wearables: 30,
      Tablets: 30,
      Gaming: 40,
      'Home Appliances': 40,
      Kitchen: 30,
      'Smart Home': 25,
      'Monitors & Accessories': 30,
      'Storage & Networking': 20,
      'Fitness & Outdoors': 15,
    });
  });

  it('includes the audit example queries', () => {
    expect(getSearchTermBySlug('macbook-air-13')?.query).toBe('macbook air 13');
    expect(
      getSearchTermBySlug('wireless-noise-cancelling-headphones')?.query
    ).toBe('wireless noise cancelling headphones');
    expect(
      getSearchTermBySlug('samsung-galaxy-s24-ultra-price')?.query
    ).toBe('samsung galaxy s24 ultra price');
    expect(getSearchTermBySlug('best-budget-laptop-2026')?.query).toBe(
      'best budget laptop 2026'
    );
  });
});

describe('getSearchTermBySlug — page resolution', () => {
  it('resolves every curated slug back to its term', () => {
    for (const term of SEARCH_TERMS) {
      const resolved = getSearchTermBySlug(term.slug);
      expect(resolved).not.toBeNull();
      expect(resolved?.query).toBe(term.query);
      expect(resolved?.category).toBe(term.category);
    }
  });

  it('is case-insensitive on the slug', () => {
    expect(getSearchTermBySlug('MacBook-Air-13')?.query).toBe('macbook air 13');
  });

  it('returns null for unknown queries (page -> not-found)', () => {
    expect(getSearchTermBySlug('no-such-query')).toBeNull();
    expect(getSearchTermBySlug('sample-laptop')).toBeNull();
    expect(getSearchTermBySlug('')).toBeNull();
    expect(getSearchTermBySlug('macbook-air-13-pro-max-ultra-xyz')).toBeNull();
  });
});

describe('find store links', () => {
  it('covers all 84 store entries: 80 local + 4 global', () => {
    expect(LOCAL_STORES.length).toBe(80);
    expect(GLOBAL_STORES.length).toBe(4);
    expect(ALL_FIND_STORES.length).toBe(84);
  });

  it('total link instances are 500 queries x 84 stores = 42,000', () => {
    expect(getFindLinkInstanceTotal()).toBe(42000);
  });

  it('every query links to 83 unique store search URLs', () => {
    // 84 entries collapse to 83 unique URLs: the eBay US local entry
    // and the global eBay entry both point at ebay.com.
    for (const query of ['macbook air 13', 'best budget laptop 2026']) {
      const links = getFindQueryStoreLinks(query);
      expect(links.length).toBe(83);
      expect(new Set(links.map((link) => link.url)).size).toBe(83);
      const ebayCom = links.filter(
        (link) => new URL(link.url).hostname === 'www.ebay.com'
      );
      expect(ebayCom.length).toBe(1);
    }
  });

  it('every link is a real https URL on the store domain with no placeholders', { timeout: 60000 }, () => {
    for (const term of SEARCH_TERMS) {
      const links = getFindQueryStoreLinks(term.query);
      expect(links.length).toBe(83);
      for (const { store, url } of links) {
        // No unfilled template placeholders.
        expect(url).not.toContain('{q}');
        expect(url).not.toContain('{slug}');
        const parsed = new URL(url);
        expect(parsed.protocol).toBe('https:');
        // The link stays on the store's own search host — never an
        // invented URL. The template host is the source of truth.
        const templateHost = new URL(store.searchUrlTemplate).hostname;
        expect(parsed.hostname).toBe(templateHost);
        // The encoded query is in the URL.
        expect(url).toContain(encodeURIComponent(term.query));
      }
    }
  });

  it('every store entry appears once per query (before URL dedupe)', () => {
    // The dedupe drops exactly one entry per query (eBay US vs global).
    const links = getFindQueryStoreLinks('iphone 15 price');
    expect(links.length).toBe(ALL_FIND_STORES.length - 1);
  });
});
