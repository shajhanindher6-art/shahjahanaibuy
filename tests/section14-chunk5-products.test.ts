/**
 * Section 14, chunk 5 — product / catalog tests.
 *
 * Covers, with a faked Supabase client (no DB, no network):
 * - getProducts sort=name (SQL order) and sort=price (lowest
 *   in-stock merchant price; unpriced products sort last), and
 *   that the price-sort path still excludes 'sample-laptop' in the
 *   query, not by post-filtering.
 * - getLowestMerchantPrices: cheapest in-stock row wins, out-of-
 *   stock rows are ignored, merchantCount counts distinct in-stock
 *   merchants only.
 * - getProductBySlug / getProductById never return 'sample-laptop'.
 * - getBrands / getCategories never surface the health-check row's
 *   brand ('Sample') or inflate a category count with it.
 * - ProductGallery static render: no recorded rows → the single
 *   product image (honest fallback, no thumbnails); recorded rows
 *   → primary first with thumbnail buttons and a "Photo X of N"
 *   caption.
 *
 * The fake applies the recorded PostgREST calls the way the real
 * client would (filters, then order, then range/limit; count is the
 * filtered total before paging), so the tests prove the exclusion
 * and the sort happen in the query.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  getProducts,
  getLowestMerchantPrices,
  getProductBySlug,
  getProductById,
  getBrands,
  getCategories,
} from '@/services/products';
import { ProductGallery } from '@/components/products/product-gallery';
import type { AnySupabaseClient } from '@/lib/supabase/types';

type Row = Record<string, unknown>;

function productRow(overrides: Partial<Row>): Row {
  return {
    id: '1',
    name: 'MacBook Air 13',
    slug: 'macbook-air-13',
    description: 'Apple MacBook Air 13.',
    brand: 'Apple',
    category: 'Laptops',
    image_url: null,
    gtin: null,
    confidence_score: 100,
    data_freshness: 'fresh',
    deleted_at: null,
    // Section 17, Stage C item 15: the public query path filters
    // status = 'published' in the query — the fake rows are
    // published rows, so the filter passes them through.
    status: 'published',
    price_verification_status: 'unverified',
    price_verified_at: null,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    ...overrides,
  };
}

const macbook = productRow({});
const galaxy = productRow({
  id: '2',
  name: 'Galaxy S24 Ultra',
  slug: 'galaxy-s24-ultra',
  brand: 'Samsung',
  created_at: '2026-11-02T00:00:00Z',
});
const logitech = productRow({
  id: '3',
  name: 'Logitech MX Master 3S',
  slug: 'logitech-mx-master-3s',
  brand: 'Logitech',
  category: 'Accessories',
  created_at: '2026-11-03T00:00:00Z',
});
const sampleLaptop = productRow({
  id: '9',
  name: 'Sample Laptop',
  slug: 'sample-laptop',
  description: 'Demo product for initial database health check',
  brand: 'Sample',
  created_at: '2026-11-04T00:00:00Z',
});

function merchantRow(overrides: Partial<Row>): Row {
  return {
    product_id: '1',
    merchant_id: 'm-amazon',
    price: 999,
    in_stock: true,
    deleted_at: null,
    ...overrides,
  };
}

type Op =
  | { kind: 'eq'; col: string; value: unknown }
  | { kind: 'neq'; col: string; value: unknown }
  | { kind: 'is'; col: string; value: unknown }
  | { kind: 'not'; col: string; value: unknown }
  | { kind: 'in'; col: string; values: unknown[] }
  | { kind: 'or' }
  | { kind: 'order'; col: string; ascending: boolean }
  | { kind: 'range'; from: number; to: number }
  | { kind: 'limit'; n: number };

function applyOps(rows: Row[], ops: Op[]): Row[] {
  let out = [...rows];
  for (const op of ops) {
    if (op.kind === 'eq') out = out.filter((r) => r[op.col] === op.value);
    if (op.kind === 'neq') out = out.filter((r) => r[op.col] !== op.value);
    if (op.kind === 'is') out = out.filter((r) => r[op.col] === op.value);
    if (op.kind === 'not') out = out.filter((r) => r[op.col] !== op.value);
    if (op.kind === 'in') out = out.filter((r) => op.values.includes(r[op.col]));
    // 'or' (search) is a no-op in this fake: sort tests use no search.
  }
  const order = ops.find((o) => o.kind === 'order') as
    | { kind: 'order'; col: string; ascending: boolean }
    | undefined;
  if (order) {
    out = [...out].sort((a, b) => {
      const av = a[order.col];
      const bv = b[order.col];
      if (av === bv) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      // Numeric columns (prices) must compare numerically, not as
      // strings ('1019' < '999' lexicographically — wrong).
      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av) < String(bv)
            ? -1
            : 1;
      return order.ascending ? cmp : -cmp;
    });
  }
  for (const op of ops) {
    if (op.kind === 'range') out = out.slice(op.from, op.to + 1);
    if (op.kind === 'limit') out = out.slice(0, op.n);
  }
  return out;
}

function filteredCount(rows: Row[], ops: Op[]): number {
  let out = [...rows];
  for (const op of ops) {
    if (op.kind === 'eq') out = out.filter((r) => r[op.col] === op.value);
    if (op.kind === 'neq') out = out.filter((r) => r[op.col] !== op.value);
    if (op.kind === 'is') out = out.filter((r) => r[op.col] === op.value);
    if (op.kind === 'not') out = out.filter((r) => r[op.col] !== op.value);
    if (op.kind === 'in') out = out.filter((r) => op.values.includes(r[op.col]));
  }
  return out.length;
}

function fakeClient(tables: Record<string, Row[]>) {
  const client = {
    from: (table: string) => {
      const ops: Op[] = [];
      const rows = tables[table] ?? [];
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.is = (col: string, value: unknown) => {
        ops.push({ kind: 'is', col, value });
        return chain;
      };
      chain.not = (col: string, _op: string, value: unknown) => {
        ops.push({ kind: 'not', col, value });
        return chain;
      };
      chain.neq = (col: string, value: unknown) => {
        ops.push({ kind: 'neq', col, value });
        return chain;
      };
      chain.eq = (col: string, value: unknown) => {
        ops.push({ kind: 'eq', col, value });
        return chain;
      };
      chain.in = (col: string, values: unknown[]) => {
        ops.push({ kind: 'in', col, values });
        return chain;
      };
      chain.or = () => {
        ops.push({ kind: 'or' });
        return chain;
      };
      chain.order = (col: string, opts?: { ascending?: boolean }) => {
        ops.push({ kind: 'order', col, ascending: opts?.ascending ?? true });
        return chain;
      };
      chain.range = (from: number, to: number) => {
        ops.push({ kind: 'range', from, to });
        return chain;
      };
      chain.limit = (n: number) => {
        ops.push({ kind: 'limit', n });
        return chain;
      };
      chain.maybeSingle = async () => {
        const out = applyOps(rows, ops);
        return { data: out[0] ?? null, error: null };
      };
      chain.single = async () => {
        const out = applyOps(rows, ops);
        return { data: out[0] ?? null, error: null };
      };
      chain.then = (resolve: (v: unknown) => void) => {
        const out = applyOps(rows, ops);
        resolve({ data: out, error: null, count: filteredCount(rows, ops) });
      };
      return chain;
    },
  } as unknown as AnySupabaseClient;
  return client;
}

describe('getProducts sorting (Section 14, chunk 5)', () => {
  const rows = [macbook, galaxy, logitech, sampleLaptop];

  it('sort=name orders A–Z ascending and Z–A descending', async () => {
    const client = fakeClient({ products: rows });
    const asc = await getProducts(client, { sort: 'name', order: 'asc', pageSize: 100 });
    expect(asc.products.map((p) => p.slug)).toEqual([
      'galaxy-s24-ultra',
      'logitech-mx-master-3s',
      'macbook-air-13',
    ]);
    const desc = await getProducts(client, { sort: 'name', order: 'desc', pageSize: 100 });
    expect(desc.products.map((p) => p.slug)).toEqual([
      'macbook-air-13',
      'logitech-mx-master-3s',
      'galaxy-s24-ultra',
    ]);
  });

  it('sort=price orders by lowest in-stock merchant price, unpriced last', async () => {
    const client = fakeClient({
      products: rows,
      merchant_products: [
        merchantRow({ product_id: '1', merchant_id: 'm-amazon', price: 999 }),
        merchantRow({ product_id: '1', merchant_id: 'm-bestbuy', price: 1019 }),
        merchantRow({ product_id: '2', merchant_id: 'm-amazon', price: 1199 }),
        // Logitech has only an out-of-stock row: no price, sorts last.
        merchantRow({ product_id: '3', merchant_id: 'm-amazon', price: 50, in_stock: false }),
      ],
    });
    const asc = await getProducts(client, { sort: 'price', order: 'asc', pageSize: 100 });
    expect(asc.products.map((p) => p.slug)).toEqual([
      'macbook-air-13',
      'galaxy-s24-ultra',
      'logitech-mx-master-3s',
    ]);
    const desc = await getProducts(client, { sort: 'price', order: 'desc', pageSize: 100 });
    expect(desc.products.map((p) => p.slug)).toEqual([
      'galaxy-s24-ultra',
      'macbook-air-13',
      'logitech-mx-master-3s',
    ]);
    expect(asc.total).toBe(3);
  });

  it('price sort still excludes sample-laptop even with a merchant row for it', async () => {
    const client = fakeClient({
      products: rows,
      merchant_products: [
        merchantRow({ product_id: '9', merchant_id: 'm-amazon', price: 1 }),
        merchantRow({ product_id: '1', merchant_id: 'm-amazon', price: 999 }),
      ],
    });
    const result = await getProducts(client, { sort: 'price', order: 'asc', pageSize: 100 });
    expect(result.products.map((p) => p.slug)).not.toContain('sample-laptop');
    expect(result.total).toBe(3);
  });
});

describe('getLowestMerchantPrices', () => {
  it('cheapest in-stock row wins; merchantCount counts distinct in-stock merchants', async () => {
    const client = fakeClient({
      merchant_products: [
        merchantRow({ product_id: '1', merchant_id: 'm-bestbuy', price: 1019 }),
        merchantRow({ product_id: '1', merchant_id: 'm-amazon', price: 999 }),
        merchantRow({ product_id: '1', merchant_id: 'm-amazon', price: 899, in_stock: false }),
        merchantRow({ product_id: '2', merchant_id: 'm-amazon', price: 1199 }),
      ],
    });
    const prices = await getLowestMerchantPrices(client, ['1', '2', '3']);
    // Section 16, #30: the result also carries the cheapest row's
    // compare-at price and its discount — these fixture rows carry
    // no compare_at_price, so both are null (not omitted).
    // Section 17, Stage C item 14: it also carries the cheapest
    // row's verification — these fixture rows carry none, so
    // unverified / manual-intake / null (not omitted).
    expect(prices.get('1')).toEqual({
      price: 999,
      merchantCount: 2,
      compareAtPrice: null,
      discountPercent: null,
      priceVerificationStatus: 'unverified',
      priceSource: 'manual-intake',
      priceVerifiedAt: null,
    });
    expect(prices.get('2')).toEqual({
      price: 1199,
      merchantCount: 1,
      compareAtPrice: null,
      discountPercent: null,
      priceVerificationStatus: 'unverified',
      priceSource: 'manual-intake',
      priceVerifiedAt: null,
    });
    expect(prices.has('3')).toBe(false);
  });
});

describe('sample-laptop exclusion in single-product lookups', () => {
  it('getProductBySlug returns null for sample-laptop', async () => {
    const client = fakeClient({ products: [macbook, sampleLaptop] });
    expect(await getProductBySlug(client, 'sample-laptop')).toBeNull();
    expect((await getProductBySlug(client, 'macbook-air-13'))?.slug).toBe('macbook-air-13');
  });

  it('getProductById returns null for the sample-laptop id', async () => {
    const client = fakeClient({ products: [macbook, sampleLaptop] });
    expect(await getProductById(client, '9')).toBeNull();
    expect((await getProductById(client, '1'))?.slug).toBe('macbook-air-13');
  });

  it('getBrands never lists the Sample brand; getCategories ignores the row', async () => {
    const client = fakeClient({ products: [macbook, galaxy, logitech, sampleLaptop] });
    expect(await getBrands(client)).toEqual(['Apple', 'Logitech', 'Samsung']);
    expect(await getCategories(client)).toEqual(['Accessories', 'Laptops']);
  });
});

describe('ProductGallery static render', () => {
  it('no recorded rows → single product image, no thumbnails, no photo count', () => {
    const html = renderToStaticMarkup(
      createElement(ProductGallery, {
        images: [],
        fallbackImageUrl: 'https://example.com/macbook.jpg',
        productName: 'MacBook Air 13',
      })
    );
    expect(html).toContain('https://example.com/macbook.jpg');
    expect(html).not.toContain('Photo 1 of');
    expect(html).not.toContain('<button');
  });

  it('no rows and no image → placeholder, no img tag', () => {
    const html = renderToStaticMarkup(
      createElement(ProductGallery, {
        images: [],
        fallbackImageUrl: null,
        productName: 'MacBook Air 13',
      })
    );
    expect(html).not.toContain('<img');
  });

  it('recorded rows → primary first with thumbnails and a photo count', () => {
    const html = renderToStaticMarkup(
      createElement(ProductGallery, {
        images: [
          { id: 'a', url: 'https://example.com/2.jpg', altText: 'Side view', isPrimary: false },
          { id: 'b', url: 'https://example.com/1.jpg', altText: 'Front view', isPrimary: true },
        ],
        fallbackImageUrl: 'https://example.com/macbook.jpg',
        productName: 'MacBook Air 13',
      })
    );
    expect(html).toContain('Photo 1 of 2');
    expect(html).toContain('Show photo 1 of 2');
    expect(html).toContain('Show photo 2 of 2');
    // Primary image is the main image (first in the ordered list).
    const mainImg = html.indexOf('https://example.com/1.jpg');
    const thumbImg = html.indexOf('https://example.com/2.jpg');
    expect(mainImg).toBeGreaterThan(-1);
    expect(thumbImg).toBeGreaterThan(-1);
    expect(mainImg).toBeLessThan(thumbImg);
  });
});
