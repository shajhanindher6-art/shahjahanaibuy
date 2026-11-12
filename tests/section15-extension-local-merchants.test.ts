/**
 * Section 15, W2D — Extension local merchants (C6) + extension
 * banner store search links (A12).
 *
 * C6: manifest.json + content.js cover Daraz, PriceOye, Noon,
 * Jumia and Flipkart with generic detection only — no
 * merchant-specific DOM selector for these five is verified, so
 * none is invented. A12: GET /api/v1/extension/price returns
 * store search links in meta.storeLinks (lib/stores.ts builders)
 * and the banner renders them as an "also search on" row.
 *
 * Route tests run against a mocked Supabase client (in-memory
 * products + merchant_products tables); no DB, no network.
 * content.js / manifest.json are asserted statically in the
 * repo's existing style (read the source, assert on it).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';

const root = (...parts: string[]) => join(process.cwd(), ...parts);
const read = (rel: string) => readFileSync(root(rel), 'utf8');

// ---------------------------------------------------------------------------
// C6 — manifest.json
// ---------------------------------------------------------------------------

interface ExtensionManifest {
  version?: string;
  description?: string;
  content_scripts?: Array<{ matches?: string[] }>;
  host_permissions?: string[];
}

const manifest = JSON.parse(read('extension/manifest.json')) as ExtensionManifest;
const matches = manifest.content_scripts?.[0]?.matches ?? [];
const hostPermissions = manifest.host_permissions ?? [];

// The five new merchants' match hosts (one pattern per domain the
// extension must run on). Jumia/Daraz have several country domains.
const NEW_MERCHANT_HOSTS = [
  'https://*.daraz.pk/*',
  'https://*.daraz.com.bd/*',
  'https://*.daraz.lk/*',
  'https://*.daraz.com.np/*',
  'https://*.priceoye.pk/*',
  'https://*.noon.com/*',
  'https://*.jumia.com.ng/*',
  'https://*.jumia.com.eg/*',
  'https://*.jumia.co.ke/*',
  'https://*.jumia.ma/*',
  'https://*.jumia.ci/*',
  'https://*.jumia.sn/*',
  'https://*.jumia.ug/*',
  'https://*.jumia.com.gh/*',
  'https://*.flipkart.com/*',
];

const ORIGINAL_HOSTS = [
  'https://*.amazon.com/*',
  'https://*.walmart.com/*',
  'https://*.bestbuy.com/*',
  'https://*.ebay.com/*',
  'https://*.aliexpress.com/*',
];

describe('C6 — extension manifest covers the five local merchants', () => {
  it('lists every new merchant host in content-script matches', () => {
    for (const host of NEW_MERCHANT_HOSTS) {
      expect(matches).toContain(host);
    }
  });

  it('grants host_permissions for every new merchant host', () => {
    for (const host of NEW_MERCHANT_HOSTS) {
      expect(hostPermissions).toContain(host);
    }
  });

  it('keeps the original five merchants', () => {
    for (const host of ORIGINAL_HOSTS) {
      expect(matches).toContain(host);
      expect(hostPermissions).toContain(host);
    }
  });

  it('names the new merchants in the description', () => {
    for (const name of ['Daraz', 'PriceOye', 'Noon', 'Jumia', 'Flipkart']) {
      expect(manifest.description).toContain(name);
    }
  });

  it('does not bump the version in this batch (stays 2.0.0)', () => {
    expect(manifest.version).toBe('2.0.0');
  });
});

// ---------------------------------------------------------------------------
// C6 + A12 — extension/content.js (static)
// ---------------------------------------------------------------------------

const contentJs = read('extension/content.js');

describe('C6 — content.js generic detection for the new merchants', () => {
  it('has a RETAILER_PATTERNS entry for each new merchant', () => {
    for (const key of ['daraz', 'priceoye', 'noon', 'jumia', 'flipkart']) {
      expect(contentJs).toContain(`  ${key}: {`);
    }
  });

  it('matches the verified lib/stores.ts domains, not invented ones', () => {
    expect(contentJs).toContain(String.raw`daraz\.(pk|com\.bd|lk|com\.np)`);
    expect(contentJs).toContain(String.raw`priceoye\.pk`);
    expect(contentJs).toContain(String.raw`noon\.com`);
    expect(contentJs).toContain(String.raw`jumia\.(com\.ng|com\.eg|co\.ke|ma|ci|sn|ug|com\.gh)`);
    expect(contentJs).toContain(String.raw`flipkart\.com`);
  });

  it('uses generic detection for the new merchants — no invented merchant selectors', () => {
    // Every new-merchant entry uses the generic first h1 + the
    // generic price scan, and nothing merchant-specific.
    const newMerchantBlock = contentJs.slice(contentJs.indexOf('  daraz: {'));
    for (const key of ['daraz', 'priceoye', 'noon', 'jumia', 'flipkart']) {
      const start = newMerchantBlock.indexOf(`  ${key}: {`);
      const block = newMerchantBlock.slice(start, newMerchantBlock.indexOf('},', start));
      expect(block).toContain("titleSelector: 'h1'");
      expect(block).toContain('genericPrice: true');
    }
    expect(contentJs).not.toMatch(/daraz.*class|priceoye.*class|noon.*class|jumia.*class|flipkart.*class/i);
  });

  it('defines the generic price scan and uses it in extractProductInfo', () => {
    expect(contentJs).toContain('function findGenericPriceEl()');
    expect(contentJs).toContain('[itemprop="price"]');
    expect(contentJs).toContain('config.genericPrice');
    expect(contentJs).toContain('findGenericPriceEl()');
  });

  it('says the overlay runs on ten retailer domains, not five', () => {
    expect(contentJs).toContain('ten retailer');
    expect(contentJs).not.toContain('five retailer');
  });
});

describe('A12 — content.js renders store search links in the banner', () => {
  it('fetches store links from the extension price endpoint', () => {
    expect(contentJs).toContain('function fetchStoreLinks(productSlug)');
    expect(contentJs).toContain('/api/v1/extension/price?slug=');
    expect(contentJs).toContain('meta.storeLinks');
  });

  it('passes store links into the overlay and renders them honestly', () => {
    expect(contentJs).toContain(
      'createPriceOverlay(productInfo, bestPrice, history, productSlug, storeLinks)'
    );
    expect(contentJs).toContain('Also search for this product on:');
    expect(contentJs).toContain(
      'Search links to each store — prices and stock are shown by the store itself.'
    );
  });

  it('renders nothing for the links row when the fetch fails', () => {
    // fetchStoreLinks returns [] on any failure, and the overlay
    // only builds the row when links.length > 0.
    expect(contentJs).toContain('if (!res.ok) return [];');
    expect(contentJs).toContain('if (links.length > 0)');
  });
});

// ---------------------------------------------------------------------------
// A12 — GET /api/v1/extension/price (mocked Supabase)
// ---------------------------------------------------------------------------

const fakeDb = vi.hoisted(() => ({
  product: {
    id: 'prod-1',
    name: 'MacBook Air 13',
    slug: 'macbook-air-13',
  } as Record<string, unknown> | null,
  offers: [
    {
      price: 999,
      compare_at_price: 1099,
      url: 'https://www.amazon.com/dp/B0EXAMPLE',
      in_stock: true,
      availability: 'in_stock',
      products: { name: 'MacBook Air 13', slug: 'macbook-air-13' },
      merchants: { name: 'Amazon' },
    },
    {
      price: 1099,
      compare_at_price: null,
      url: 'https://www.bestbuy.com/site/macbook-air-13',
      in_stock: true,
      availability: 'in_stock',
      products: { name: 'MacBook Air 13', slug: 'macbook-air-13' },
      merchants: { name: 'Best Buy' },
    },
    {
      price: 899,
      compare_at_price: null,
      url: 'https://www.ebay.com/itm/123',
      in_stock: false,
      availability: 'out_of_stock',
      products: { name: 'MacBook Air 13', slug: 'macbook-air-13' },
      merchants: { name: 'eBay' },
    },
  ] as Record<string, unknown>[],
  offersError: null as { message: string } | null,
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      const result =
        table === 'products'
          ? { data: fakeDb.product, error: null }
          : { data: fakeDb.offers, error: fakeDb.offersError };
      // Chainable fake query: every filter returns the chain;
      // maybeSingle() resolves the product row; awaiting the
      // chain itself resolves the merchant_products rows.
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'neq', 'ilike', 'is', 'order', 'limit']) {
        chain[method] = () => chain;
      }
      chain.maybeSingle = async () => result;
      chain.then = (resolve: (value: unknown) => void) => resolve(result);
      return chain;
    },
  }),
}));

// Imported after the mock so the route uses the fake client.
import { GET } from '@/app/api/v1/extension/price/route';
import { buildExtensionStoreLinks } from '@/lib/extension-store-links';

function priceRequest(query: string, ip = '203.0.113.7') {
  return new NextRequest(`http://localhost/api/v1/extension/price${query}`, {
    headers: { 'x-real-ip': ip },
  });
}

interface PriceResponseBody {
  success: boolean;
  data: Array<{ merchant: string | null; price: number }>;
  meta?: {
    product?: { name: string; slug: string } | null;
    note?: string;
    storeLinks?: Array<{ name: string; slug: string; countryCode: string; url: string }>;
  };
  error?: { message: string };
}

async function getPrice(query: string, ip = '203.0.113.7'): Promise<{ status: number; body: PriceResponseBody }> {
  const res = await GET(priceRequest(query, ip));
  return { status: res.status, body: (await res.json()) as PriceResponseBody };
}

describe('A12 — buildExtensionStoreLinks (pure builder)', () => {
  it('returns global + flagship links without a country, excluding offered merchants', () => {
    const links = buildExtensionStoreLinks('MacBook Air 13', null, ['Amazon']);
    const slugs = links.map((l) => l.slug);
    expect(slugs).toContain('daraz');
    expect(slugs).toContain('priceoye');
    expect(slugs).toContain('noon');
    expect(slugs).toContain('jumia');
    expect(slugs).toContain('flipkart');
    expect(slugs).not.toContain('amazon');
    expect(slugs).toContain('ebay');
    expect(slugs).toContain('google-shopping');
    expect(links.length).toBeLessThanOrEqual(10);
  });

  it('builds each link from the verified lib/stores.ts search template', () => {
    const links = buildExtensionStoreLinks('MacBook Air 13', null, []);
    const bySlug = new Map(links.map((l) => [l.slug, l.url]));
    expect(bySlug.get('daraz')).toBe('https://www.daraz.pk/catalog/?q=MacBook%20Air%2013');
    expect(bySlug.get('priceoye')).toBe('https://www.priceoye.pk/search?q=MacBook%20Air%2013');
    expect(bySlug.get('noon')).toBe('https://www.noon.com/uae-en/search/?q=MacBook%20Air%2013');
    expect(bySlug.get('jumia')).toBe('https://www.jumia.com.ng/catalog/?q=MacBook%20Air%2013');
    expect(bySlug.get('flipkart')).toBe('https://www.flipkart.com/search?q=MacBook%20Air%2013');
  });

  it('puts the country local stores first when a country is given', () => {
    const links = buildExtensionStoreLinks('MacBook Air 13', 'PK', ['Amazon']);
    expect(links[0]?.slug).toBe('daraz');
    expect(links[1]?.slug).toBe('priceoye');
    expect(links.map((l) => l.slug)).toContain('google-shopping');
  });

  it('falls back to global + flagship for an unknown country code', () => {
    const links = buildExtensionStoreLinks('MacBook Air 13', 'ZZ', []);
    expect(links.map((l) => l.slug)).toContain('daraz');
    expect(links.map((l) => l.slug)).toContain('amazon');
  });

  it('deduplicates by slug and excludes offered merchants case-insensitively', () => {
    const links = buildExtensionStoreLinks('MacBook Air 13', 'US', ['ebay', 'AMAZON']);
    const slugs = links.map((l) => l.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).not.toContain('ebay');
    expect(slugs).not.toContain('amazon');
  });
});

describe('A12 — GET /api/v1/extension/price returns storeLinks', () => {
  beforeEach(() => {
    fakeDb.product = { id: 'prod-1', name: 'MacBook Air 13', slug: 'macbook-air-13' };
    fakeDb.offersError = null;
  });

  it('returns cheapest in-stock offers first and store links in meta', async () => {
    const { status, body } = await getPrice('?slug=macbook-air-13', '203.0.113.11');
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    // Out-of-stock eBay row is excluded; cheapest first.
    expect(body.data.map((o) => o.price)).toEqual([999, 1099]);
    expect(body.data[0]?.merchant).toBe('Amazon');
    const slugs = (body.meta?.storeLinks ?? []).map((l) => l.slug);
    expect(slugs).toEqual(
      expect.arrayContaining(['daraz', 'priceoye', 'noon', 'jumia', 'flipkart'])
    );
    // Amazon is a priced offer, so it must not also appear as a link.
    expect(slugs).not.toContain('amazon');
    expect(slugs).not.toContain('bestbuy');
  });

  it('honours country=PK: local stores first', async () => {
    const { body } = await getPrice('?slug=macbook-air-13&country=PK', '203.0.113.12');
    const links = body.meta?.storeLinks ?? [];
    expect(links[0]?.slug).toBe('daraz');
    expect(links[1]?.slug).toBe('priceoye');
    expect(links[0]?.url).toBe('https://www.daraz.pk/catalog/?q=MacBook%20Air%2013');
  });

  it('resolves by q as well as by slug', async () => {
    const { status, body } = await getPrice('?q=MacBook', '203.0.113.13');
    expect(status).toBe(200);
    expect(body.meta?.product?.slug).toBe('macbook-air-13');
    expect((body.meta?.storeLinks ?? []).length).toBeGreaterThan(0);
  });

  it('returns empty storeLinks when no catalog product matches', async () => {
    fakeDb.product = null;
    const { status, body } = await getPrice('?slug=no-such-product', '203.0.113.14');
    expect(status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.meta?.product).toBeNull();
    expect(body.meta?.storeLinks).toEqual([]);
  });

  it('still returns store links when the offers query fails', async () => {
    fakeDb.offersError = { message: 'boom' };
    const { status, body } = await getPrice('?slug=macbook-air-13', '203.0.113.15');
    expect(status).toBe(200);
    expect(body.data).toEqual([]);
    expect((body.meta?.storeLinks ?? []).map((l) => l.slug)).toContain('daraz');
  });

  it('rejects a request with neither slug nor q', async () => {
    const { status, body } = await getPrice('', '203.0.113.16');
    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error?.message).toMatch(/slug or q is required/);
  });
});

// ---------------------------------------------------------------------------
// C6 — /extension page copy
// ---------------------------------------------------------------------------

const extensionPage = read('app/extension/page.tsx');

describe('C6 — /extension page lists the new merchants honestly', () => {
  it('names Daraz, PriceOye, Noon, Jumia and Flipkart', () => {
    for (const name of ['Daraz', 'PriceOye', 'Noon', 'Jumia', 'Flipkart']) {
      expect(extensionPage).toContain(name);
    }
  });

  it('still says unpacked install only and does not claim a store listing', () => {
    expect(extensionPage).toContain('not on the Chrome Web Store yet');
    expect(extensionPage).not.toMatch(/available on the Chrome Web Store|get it on the Chrome Web Store/i);
  });

  it('states the generic-detection limit for the new merchants', () => {
    expect(extensionPage).toContain('generic page detection');
    expect(extensionPage).toContain('may not appear on some of their product pages');
  });

  it('documents the extension price endpoint with its store links', () => {
    expect(extensionPage).toContain('/api/v1/extension/price?slug=');
    expect(extensionPage).toContain('country=PK');
  });
});
