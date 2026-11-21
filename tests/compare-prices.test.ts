/**
 * Unit tests for lib/offers/comparePrices.
 * The Supabase client is injected as a mock — no database, no network.
 */

import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  comparePrices,
  effectivePriceOf,
  roundMoney,
} from '@/lib/offers/comparePrices';
import type { MerchantOfferRow } from '@/lib/offers/types';

/** Minimal thenable stub of the Supabase query builder. */
class MockQuery {
  private filters: Array<[string, unknown]> = [];
  constructor(private rows: MerchantOfferRow[]) {}
  select(): this {
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }
  then(
    resolve: (value: { data: MerchantOfferRow[] | null; error: { message: string } | null }) => void,
  ): void {
    const data = this.rows.filter((row) =>
      this.filters.every(([column, value]) => (row as unknown as Record<string, unknown>)[column] === value),
    );
    resolve({ data, error: null });
  }
}

class MockFailingQuery extends MockQuery {
  override then(
    resolve: (value: { data: null; error: { message: string } }) => void,
  ): void {
    resolve({ data: null, error: { message: 'boom' } });
  }
}

function mockClient(rows: MerchantOfferRow[], failing = false): SupabaseClient {
  const query = failing ? new MockFailingQuery(rows) : new MockQuery(rows);
  return {
    from: () => ({ select: () => query }),
  } as unknown as SupabaseClient;
}

function offer(overrides: Partial<MerchantOfferRow> & { price: number }): MerchantOfferRow {
  return {
    network: 'cj',
    advertiser_id: '3992613',
    advertiser_name: 'DHGate',
    external_product_id: 'DH-1',
    gtin: '012345678905',
    mpn: 'W-100',
    brand: 'TestBrand',
    title: 'Test Widget',
    description: null,
    image_url: 'https://images.example.com/DH-1.jpg',
    affiliate_url: 'https://example.com/buy/DH-1',
    sale_price: null,
    currency: 'USD',
    availability: 'in_stock',
    category: 'Electronics',
    is_public_live: true,
    last_synced_at: '2026-11-21T00:00:00.000Z',
    ...overrides,
  };
}

describe('effectivePriceOf / roundMoney', () => {
  it('prefers a valid sale price, else the list price', () => {
    expect(effectivePriceOf({ price: 100, sale_price: 80 })).toBe(80);
    expect(effectivePriceOf({ price: 100, sale_price: null })).toBe(100);
    expect(effectivePriceOf({ price: 100, sale_price: 0 })).toBe(100);
  });

  it('rounds money to cents', () => {
    expect(roundMoney(10.005)).toBe(10.01);
    expect(roundMoney(29.995)).toBe(30);
  });
});

describe('comparePrices', () => {
  it('returns live offers cheapest-first with exact savings', async () => {
    const rows = [
      offer({ network: 'amazon', advertiser_id: 'amzn', advertiser_name: 'Amazon', price: 120 }),
      offer({ price: 100, sale_price: 90 }),
      offer({ price: 95, external_product_id: 'DH-2' }),
    ];
    const result = await comparePrices({ gtin: '012345678905' }, mockClient(rows));
    expect(result.offers.map((o) => o.effective_price)).toEqual([90, 95, 120]);
    expect(result.lowest_price).toBe(90);
    expect(result.highest_price).toBe(120);
    expect(result.savings).toBe(30);
    expect(result.currency).toBe('USD');
    expect(result.gtin).toBe('012345678905');
  });

  it('returns savings 0 with a single offer', async () => {
    const result = await comparePrices(
      { gtin: '012345678905' },
      mockClient([offer({ price: 50 })]),
    );
    expect(result.offers).toHaveLength(1);
    expect(result.lowest_price).toBe(50);
    expect(result.highest_price).toBe(50);
    expect(result.savings).toBe(0);
  });

  it('returns an empty comparison when no live offers match', async () => {
    const result = await comparePrices({ gtin: '012345678905' }, mockClient([]));
    expect(result.offers).toEqual([]);
    expect(result.lowest_price).toBeNull();
    expect(result.highest_price).toBeNull();
    expect(result.savings).toBe(0);
    expect(result.currency).toBeNull();
  });

  it('filters out non-live and out-of-stock rows at the query level', async () => {
    // The mock applies the same eq() filters the real query uses,
    // so rows with is_public_live=false or availability!=in_stock
    // never reach the comparison.
    const rows = [
      offer({ price: 10, is_public_live: false }),
      offer({ price: 20, availability: 'out_of_stock' }),
      offer({ price: 30 }),
    ];
    const result = await comparePrices({ gtin: '012345678905' }, mockClient(rows));
    expect(result.offers.map((o) => o.effective_price)).toEqual([30]);
    expect(result.savings).toBe(0);
  });

  it('matches by MPN + brand when no GTIN is given', async () => {
    const rows = [
      offer({ gtin: null, price: 40 }),
      offer({ gtin: null, mpn: 'OTHER', price: 10 }),
      offer({ gtin: null, brand: 'OtherBrand', price: 5 }),
    ];
    const result = await comparePrices(
      { mpn: 'W-100', brand: 'TestBrand' },
      mockClient(rows),
    );
    expect(result.offers.map((o) => o.effective_price)).toEqual([40]);
    expect(result.gtin).toBeNull();
    expect(result.mpn).toBe('W-100');
  });

  it('normalizes a GTIN with separators before matching', async () => {
    const result = await comparePrices(
      { gtin: '0123-4567 8905' },
      mockClient([offer({ price: 25 })]),
    );
    expect(result.offers).toHaveLength(1);
    expect(result.gtin).toBe('012345678905');
  });

  it('returns an empty comparison when the GTIN is invalid and no MPN+brand is given', async () => {
    let fromCalled = false;
    const client = {
      from: () => {
        fromCalled = true;
        return { select: () => new MockQuery([]) };
      },
    } as unknown as SupabaseClient;
    const result = await comparePrices({ gtin: '1234567890123' }, client);
    expect(result.offers).toEqual([]);
    expect(fromCalled).toBe(false);
  });

  it('throws when the query fails', async () => {
    await expect(
      comparePrices({ gtin: '012345678905' }, mockClient([], true)),
    ).rejects.toThrow('merchant_offers query failed: boom');
  });

  it('throws when no client is configured (no service-role key)', async () => {
    // tests/setup.ts sets only the placeholder public vars — the
    // service-role key is unset, so the default client is null.
    await expect(comparePrices({ gtin: '012345678905' })).rejects.toThrow(
      'Supabase service client is not configured',
    );
  });
});
