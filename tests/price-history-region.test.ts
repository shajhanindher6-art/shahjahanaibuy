/**
 * price_history.region (migration 072) — resolvePriceRegion + the
 * tiered 42703 retry in insertPriceHistoryRow.
 *
 * Post-Integration Verification & Real Data Phase, 2026-11-14.
 *
 * The region is the 2-letter code a price was observed in
 * ('US' for Best Buy and eBay EBAY_US today). It rides the same
 * tiered retry as the 060 code and the 057 provenance: tier 1–3
 * carry it when the caller wanted one, tier 3b drops it while
 * keeping 060 + 057, and tier 4 is the migration-002 fallback.
 * A caller that passes no region sees byte-identical inserts
 * and identical attempt counts to before — the region tiers
 * are skipped entirely.
 *
 * Fake client (same shape as the F-P1-15/F-P1-30 helper in
 * tests/final100-verification-spine.test.ts): `missingColumns`
 * names the columns the fake table does not have yet; any
 * insert naming one of them fails with Postgres 42703.
 */
import { describe, expect, it } from 'vitest';

import { insertPriceHistoryRow, resolvePriceRegion } from '@/services/price-history-quality';

function historyInsertFake(missingColumns: string[]) {
  const attempts: Array<Record<string, unknown>> = [];
  const stored: Array<Record<string, unknown>> = [];
  const client = {
    attempts,
    stored,
    from(table: string) {
      if (table !== 'price_history') throw new Error(`unexpected table ${table}`);
      return {
        insert: async (row: Record<string, unknown>) => {
          attempts.push(row);
          const missing = Object.keys(row).find((k) => missingColumns.includes(k));
          if (missing) {
            return { error: { code: '42703', message: `column "${missing}" does not exist` } };
          }
          stored.push(row);
          return { error: null };
        },
      };
    },
  };
  return client;
}

const HISTORY_POINT = {
  product_id: 'p-1',
  retailer_id: 'r-bestbuy',
  price: 999,
  currency: 'USD',
  availability: 'in_stock',
  source: 'merchant-feed' as const,
  recorded_at: '2026-11-14T12:00:00.000Z',
  observed_at: '2026-11-14T12:00:00.000Z',
};

describe('resolvePriceRegion', () => {
  it('normalises an explicit region to upper case', () => {
    expect(resolvePriceRegion({ region: 'us' })).toBe('US');
    expect(resolvePriceRegion({ region: ' US ' })).toBe('US');
  });

  it('falls back to the retailer country verbatim', () => {
    expect(resolvePriceRegion({ retailerCountry: 'US' })).toBe('US');
    expect(resolvePriceRegion({ region: null, retailerCountry: 'GB' })).toBe('GB');
  });

  it('prefers the explicit region over the retailer country', () => {
    expect(resolvePriceRegion({ region: 'CA', retailerCountry: 'US' })).toBe('CA');
  });

  it('returns null when nothing is known — never a guessed region', () => {
    expect(resolvePriceRegion({})).toBeNull();
    expect(resolvePriceRegion({ region: null, retailerCountry: null })).toBeNull();
    expect(resolvePriceRegion({ region: '' })).toBeNull();
  });

  it('rejects non-2-letter values instead of coercing them', () => {
    // A marketplace id is not a region code.
    expect(resolvePriceRegion({ region: 'EBAY_US' })).toBeNull();
    expect(resolvePriceRegion({ retailerCountry: 'United States' })).toBeNull();
    expect(resolvePriceRegion({ region: 'USA' })).toBeNull();
  });
});

describe('insertPriceHistoryRow — region (072) rides the tiered retry', () => {
  it('persists an explicit region when the column exists (tier 1, one attempt)', async () => {
    const client = historyInsertFake([]);
    const r = await insertPriceHistoryRow(client as never, { ...HISTORY_POINT, region: 'us' });
    expect(r.error).toBeNull();
    expect(r.regionPersisted).toBe(true);
    expect(client.attempts).toHaveLength(1);
    expect(client.stored[0]).toMatchObject({ region: 'US' });
  });

  it('derives the region from the retailer country when no region was observed', async () => {
    const client = historyInsertFake([]);
    const r = await insertPriceHistoryRow(client as never, {
      ...HISTORY_POINT,
      retailerCountry: 'US',
    });
    expect(r.error).toBeNull();
    expect(r.regionPersisted).toBe(true);
    expect(client.stored[0]).toMatchObject({ region: 'US' });
  });

  it('drops only the region when 072 is unapplied — 060 + 057 are kept (tier 3b)', async () => {
    const client = historyInsertFake(['region']);
    const r = await insertPriceHistoryRow(client as never, { ...HISTORY_POINT, region: 'US' });
    expect(r.error).toBeNull();
    expect(r.regionPersisted).toBe(false);
    // Tier 1 (region) 42703 → tier 3 (no code, region) 42703 →
    // tier 3b (code + provenance, no region) lands: the row is
    // still recorded with its provenance, just without a region.
    expect(client.attempts).toHaveLength(3);
    expect(client.stored).toHaveLength(1);
    expect(client.stored[0]).not.toHaveProperty('region');
    expect(client.stored[0]).toMatchObject({ currency_code: 'USD', source: 'merchant-feed' });
  });

  it('keeps the region when only the 060 code is missing (tier 3)', async () => {
    const client = historyInsertFake(['currency_code']);
    const r = await insertPriceHistoryRow(client as never, { ...HISTORY_POINT, region: 'US' });
    expect(r.error).toBeNull();
    expect(r.regionPersisted).toBe(true);
    expect(client.attempts).toHaveLength(2);
    expect(client.stored[0]).toMatchObject({ region: 'US', source: 'merchant-feed' });
    expect(client.stored[0]).not.toHaveProperty('currency_code');
  });

  it('a no-region caller is byte-identical to before (one attempt when columns exist)', async () => {
    const client = historyInsertFake([]);
    const r = await insertPriceHistoryRow(client as never, { ...HISTORY_POINT });
    expect(r.error).toBeNull();
    expect(r.regionPersisted).toBe(false);
    expect(client.attempts).toHaveLength(1);
    expect(client.attempts[0]).not.toHaveProperty('region');
  });

  it('a no-region caller keeps the pinned 3-attempt shape when 057 is unapplied', async () => {
    const client = historyInsertFake(['source', 'observed_at', 'suspicious_change']);
    const r = await insertPriceHistoryRow(client as never, { ...HISTORY_POINT });
    expect(r.error).toBeNull();
    expect(r.regionPersisted).toBe(false);
    // Tier 1 (057) 42703 → tier 3 (057) 42703 → tier 4 (legacy)
    // lands. Tier 3b is skipped: no region was wanted.
    expect(client.attempts).toHaveLength(3);
    expect(client.stored[0]).not.toHaveProperty('source');
  });

  it('a non-2-letter region is never stored', async () => {
    const client = historyInsertFake([]);
    const r = await insertPriceHistoryRow(client as never, {
      ...HISTORY_POINT,
      region: 'EBAY_US',
    });
    expect(r.error).toBeNull();
    expect(r.regionPersisted).toBe(false);
    expect(client.attempts).toHaveLength(1);
    expect(client.attempts[0]).not.toHaveProperty('region');
  });

  it('a non-42703 error is returned, not retried into silence', async () => {
    const client = {
      from: () => ({
        insert: async () => ({ error: { code: '23505', message: 'duplicate key' } }),
      }),
    };
    const r = await insertPriceHistoryRow(client as never, { ...HISTORY_POINT, region: 'US' });
    expect(r.error).toMatchObject({ code: '23505' });
    expect(r.regionPersisted).toBe(false);
  });
});
