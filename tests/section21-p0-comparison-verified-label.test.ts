/**
 * Section 21, P0 #1 — comparison verdicts must never carry a
 * "verified" label on unverified + stale prices (audit §1 P0 #1,
 * §12 Stage E, §14 item 1).
 *
 * Section 20 gated the CHAT label (verified AND fresh per product,
 * services/chat.ts withSourceLabel) but the comparison surface was
 * missed: services/ai-comparison.ts applied verifiedDataRangeLabel
 * unconditionally, with 0 hits for priceVerificationStatus in the
 * file. A user comparing two products was told the verdict is
 * "based on verified recorded data" when all 10 live products are
 * unverified and 11 days stale.
 *
 * Covers, against a mocked Supabase client (no DB, no network):
 * - comparison on unverified + stale products (the live catalog
 *   state) carries the RECORDED-data label, never "verified".
 * - comparison on verified + fresh products MAY carry the
 *   verified label (the gate earns it, it is not deleted).
 * - verified-but-stale, unverified-but-fresh, and mixed sets all
 *   get the recorded label — every product must be verified AND
 *   fresh, like the chat gate.
 * - recordedDataRangeLabel (lib/ai-source-label.ts) — the range
 *   counterpart of verifiedDataRangeLabel.
 * - the confirmed N+1 (audit J-P2-1 / J-5): reviews +
 *   merchant-listings are batched with `.in('product_id', ids)`
 *   — the reviews read happens exactly once per comparison, and
 *   the merchant-listings read count does NOT grow when a third
 *   product is added (the old code ran 2 queries per product).
 *   Ratings/listings behaviour is unchanged (cheapest first, one
 *   entry per merchant, real averages).
 */
import { describe, expect, it } from 'vitest';
import { compareProducts } from '@/services/ai-comparison';
import { recordedDataRangeLabel } from '@/lib/ai-source-label';
import type { AnySupabaseClient } from '@/lib/supabase/types';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const daysAgo = (d: number) => iso(now - d * DAY);

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Stub Supabase client (same chainable-builder pattern as the Section 19
// comparison tests), with a per-table query counter for the N+1 tests.
// ---------------------------------------------------------------------------

interface StubDb {
  client: AnySupabaseClient;
  calls: Record<string, number>;
}

function createStubSupabase(tables: Record<string, Row[]>): StubDb {
  const calls: Record<string, number> = {};
  const query = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      select() {
        return builder;
      },
      eq(col: string, val: unknown) {
        rows = rows.filter((r) => r[col] === val);
        return builder;
      },
      neq(col: string, val: unknown) {
        rows = rows.filter((r) => r[col] !== val);
        return builder;
      },
      gt(col: string, val: unknown) {
        rows = rows.filter((r) => {
          const v = r[col];
          if (v === null || v === undefined || val === null || val === undefined) return false;
          return String(v) > String(val);
        });
        return builder;
      },
      in(col: string, vals: unknown[]) {
        rows = rows.filter((r) => vals.includes(r[col]));
        return builder;
      },
      is(col: string, val: unknown) {
        rows = rows.filter((r) =>
          val === null ? r[col] === null || r[col] === undefined : r[col] === val
        );
        return builder;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        const asc = opts?.ascending !== false;
        rows = [...rows].sort((a, b) => {
          const av = a[col];
          const bv = b[col];
          if (av === bv) return 0;
          if (av === null || av === undefined) return 1;
          if (bv === null || bv === undefined) return -1;
          if (typeof av === 'number' && typeof bv === 'number') {
            return asc ? av - bv : bv - av;
          }
          return asc
            ? String(av).localeCompare(String(bv))
            : String(bv).localeCompare(String(av));
        });
        return builder;
      },
      limit(n: number) {
        rows = rows.slice(0, n);
        return builder;
      },
      maybeSingle() {
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      single() {
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      then(
        onFulfilled?: (value: { data: Row[]; error: null }) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) {
        return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
      },
    };
    return builder;
  };
  return {
    client: {
      from: (table: string) => {
        calls[table] = (calls[table] ?? 0) + 1;
        return query(table);
      },
    } as unknown as AnySupabaseClient,
    calls,
  };
}

function productRow(
  id: string,
  name: string,
  freshness: string | null,
  verification: string | null
): Row {
  return {
    id,
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    description: null,
    brand: 'Brand',
    category: 'Laptops',
    image_url: null,
    gtin: null,
    confidence_score: 80,
    data_freshness: freshness,
    price_verification_status: verification,
    created_at: daysAgo(30),
    updated_at: daysAgo(30),
    deleted_at: null,
  };
}

const MERCHANTS: Row[] = [
  {
    id: 'm-amazon', name: 'Amazon', slug: 'amazon', website_url: 'https://www.amazon.com',
    active: true, is_verified_merchant: false, return_window_days: null,
    warranty_months: 24, reputation_score: null, return_policy_url: null,
    warranty_policy_url: null, policy_verified_at: null, deleted_at: null,
  },
  {
    id: 'm-bb', name: 'Best Buy', slug: 'best-buy', website_url: null,
    active: true, is_verified_merchant: false, return_window_days: null,
    warranty_months: null, reputation_score: null, return_policy_url: null,
    warranty_policy_url: null, policy_verified_at: null, deleted_at: null,
  },
];

function listingsFor(ids: string[]): Row[] {
  const rows: Row[] = [];
  for (const id of ids) {
    rows.push(
      { product_id: id, merchant_id: 'm-amazon', price: 999, compare_at_price: 1099, url: null, in_stock: true, shipping_cost: 0, shipping_days: 3, deleted_at: null },
      { product_id: id, merchant_id: 'm-bb', price: 1018.98, compare_at_price: 1099, url: null, in_stock: true, shipping_cost: 12.5, shipping_days: null, deleted_at: null }
    );
  }
  return rows;
}

function reviewsFor(ids: string[]): Row[] {
  const rows: Row[] = [];
  for (const id of ids) {
    rows.push({ product_id: id, rating: 5 }, { product_id: id, rating: 4 });
  }
  return rows;
}

function historyFor(ids: string[]): Row[] {
  // 4 points per product — below the 5-point Deal Score minimum,
  // so dealScore stays null (withheld), exactly like the live
  // catalog's 4-point series.
  const rows: Row[] = [];
  for (const id of ids) {
    rows.push(
      { product_id: id, price: 1099, recorded_at: daysAgo(30) },
      { product_id: id, price: 1049, recorded_at: daysAgo(20) },
      { product_id: id, price: 999, recorded_at: daysAgo(11) },
      { product_id: id, price: 999, recorded_at: daysAgo(10) }
    );
  }
  return rows;
}

function stubDb(products: Row[]): StubDb {
  const ids = products.map((p) => p.id as string);
  return createStubSupabase({
    products,
    merchants: MERCHANTS,
    merchant_products: listingsFor(ids),
    price_history: historyFor(ids),
    reviews: reviewsFor(ids),
    retailers: [],
  });
}

// ---------------------------------------------------------------------------
// recordedDataRangeLabel — unit tests
// ---------------------------------------------------------------------------

describe('recordedDataRangeLabel', () => {
  it('names the recorded range across two real check dates', () => {
    const label = recordedDataRangeLabel([daysAgo(11), daysAgo(1)]);
    expect(label).toContain('based on recorded catalog data');
    expect(label).not.toContain('verified recorded data');
    expect(label).toContain('not checked live at the merchant');
  });

  it('a single date collapses to the recorded label with that date', () => {
    const label = recordedDataRangeLabel([daysAgo(3)]);
    expect(label).toContain('based on recorded catalog data');
    expect(label).not.toContain('verified recorded data');
  });

  it('no usable date says the age is unknown instead of implying freshness', () => {
    const label = recordedDataRangeLabel([null, null]);
    expect(label).toContain('based on recorded catalog data');
    expect(label).toContain('no freshness timestamp is recorded');
  });
});

// ---------------------------------------------------------------------------
// compareProducts — the verdict label gate
// ---------------------------------------------------------------------------

describe('compareProducts — verified label is earned, never assumed (P0 #1)', () => {
  it('UNVERIFIED + STALE (the live catalog state) must NOT carry the verified label', async () => {
    const db = stubDb([
      productRow('p1', 'MacBook Air 13', daysAgo(11), 'unverified'),
      productRow('p2', 'Dell XPS 13', daysAgo(11), 'unverified'),
    ]);
    const comparison = await compareProducts(db.client, ['p1', 'p2']);

    expect(comparison).not.toBeNull();
    expect(comparison!.sourceLabel).not.toContain('based on verified recorded data');
    expect(comparison!.sourceLabel).toContain('based on recorded catalog data');
    expect(comparison!.sourceLabel).toContain('general guidance');
    // The summary carries the same label (appendSourceLabel), so an
    // API consumer reading only aiSummary is not misled either.
    expect(comparison!.aiSummary).not.toContain('based on verified recorded data');
    expect(comparison!.aiSummary).toContain('Source: based on recorded catalog data');
    // The stamp itself is now on the product rows, for the UI.
    expect(comparison!.products[0].priceVerificationStatus).toBe('unverified');
  });

  it('VERIFIED + FRESH on every product MAY carry the verified label', async () => {
    const db = stubDb([
      productRow('p1', 'MacBook Air 13', daysAgo(1), 'verified'),
      productRow('p2', 'Dell XPS 13', daysAgo(0), 'verified'),
    ]);
    const comparison = await compareProducts(db.client, ['p1', 'p2']);

    expect(comparison).not.toBeNull();
    expect(comparison!.sourceLabel).toContain('based on verified recorded data');
    expect(comparison!.aiSummary).toContain('Source: based on verified recorded data');
    expect(comparison!.products[0].priceVerificationStatus).toBe('verified');
  });

  it('VERIFIED but STALE gets the recorded label (freshness is half the gate)', async () => {
    const db = stubDb([
      productRow('p1', 'MacBook Air 13', daysAgo(1), 'verified'),
      productRow('p2', 'Dell XPS 13', daysAgo(11), 'verified'),
    ]);
    const comparison = await compareProducts(db.client, ['p1', 'p2']);

    expect(comparison).not.toBeNull();
    expect(comparison!.sourceLabel).not.toContain('based on verified recorded data');
    expect(comparison!.sourceLabel).toContain('based on recorded catalog data');
  });

  it('UNVERIFIED but FRESH gets the recorded label (verification is half the gate)', async () => {
    const db = stubDb([
      productRow('p1', 'MacBook Air 13', daysAgo(1), 'unverified'),
      productRow('p2', 'Dell XPS 13', daysAgo(0), 'unverified'),
    ]);
    const comparison = await compareProducts(db.client, ['p1', 'p2']);

    expect(comparison).not.toBeNull();
    expect(comparison!.sourceLabel).not.toContain('based on verified recorded data');
    expect(comparison!.sourceLabel).toContain('based on recorded catalog data');
  });

  it('MIXED — one verified+fresh, one unverified — gets the recorded label', async () => {
    const db = stubDb([
      productRow('p1', 'MacBook Air 13', daysAgo(1), 'verified'),
      productRow('p2', 'Dell XPS 13', daysAgo(1), 'unverified'),
    ]);
    const comparison = await compareProducts(db.client, ['p1', 'p2']);

    expect(comparison).not.toBeNull();
    expect(comparison!.sourceLabel).not.toContain('based on verified recorded data');
    expect(comparison!.sourceLabel).toContain('based on recorded catalog data');
  });

  it('a missing verification stamp is unverified, never assumed verified', async () => {
    const db = stubDb([
      productRow('p1', 'MacBook Air 13', daysAgo(1), null),
      productRow('p2', 'Dell XPS 13', daysAgo(1), null),
    ]);
    const comparison = await compareProducts(db.client, ['p1', 'p2']);

    expect(comparison).not.toBeNull();
    expect(comparison!.sourceLabel).not.toContain('based on verified recorded data');
    expect(comparison!.sourceLabel).toContain('based on recorded catalog data');
  });
});

// ---------------------------------------------------------------------------
// compareProducts — batched reads (N+1 fix, J-P2-1 / J-5)
// ---------------------------------------------------------------------------

describe('compareProducts — reviews + listings are batched, not per-product (J-P2-1)', () => {
  it('reads reviews exactly once for a 2-product comparison', async () => {
    const db = stubDb([
      productRow('p1', 'MacBook Air 13', daysAgo(1), 'verified'),
      productRow('p2', 'Dell XPS 13', daysAgo(1), 'verified'),
    ]);
    const comparison = await compareProducts(db.client, ['p1', 'p2']);

    expect(comparison).not.toBeNull();
    expect(db.calls.reviews).toBe(1);
    // Behaviour unchanged: the batched ratings still average.
    expect(comparison!.products[0].retailers[0].rating).toBe(4.5);
    expect(comparison!.products[0].retailers[0].reviewCount).toBe(2);
  });

  it('the merchant-listings read count does NOT grow with a third product', async () => {
    const db2 = stubDb([
      productRow('p1', 'MacBook Air 13', daysAgo(1), 'verified'),
      productRow('p2', 'Dell XPS 13', daysAgo(1), 'verified'),
    ]);
    await compareProducts(db2.client, ['p1', 'p2']);
    const twoProductReads = db2.calls.merchant_products ?? 0;
    expect(db2.calls.reviews).toBe(1);

    const db3 = stubDb([
      productRow('p1', 'MacBook Air 13', daysAgo(1), 'verified'),
      productRow('p2', 'Dell XPS 13', daysAgo(1), 'verified'),
      productRow('p3', 'Sony Headphones', daysAgo(1), 'verified'),
    ]);
    const comparison3 = await compareProducts(db3.client, ['p1', 'p2', 'p3']);

    expect(comparison3).not.toBeNull();
    expect(comparison3!.products).toHaveLength(3);
    expect(db3.calls.reviews).toBe(1);
    // Old code: 2 listings reads for 2 products, 3 for 3 products.
    // Batched code: the loop's listings read is 1 in both cases,
    // so the total count is identical (any extra reads are the
    // per-merchant reliability reads, which are merchant-cached
    // and do not scale with product count either).
    expect(db3.calls.merchant_products).toBe(twoProductReads);
    // Behaviour unchanged on the third product too: cheapest
    // first, one entry per merchant.
    expect(comparison3!.products[2].retailers).toHaveLength(2);
    expect(comparison3!.products[2].retailers[0].retailerName).toBe('Amazon');
    expect(comparison3!.products[2].retailers[0].price).toBe(999);
  });
});
