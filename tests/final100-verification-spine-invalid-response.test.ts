/**
 * FINAL 100% Product & Real Data Completion — W1 verification spine,
 * F-P2-20: the invalid-response path, end to end.
 *
 * Provider output -> validateProviderRefreshResult -> price_history.
 * An invalid or incomplete provider response must be REJECTED,
 * never stored: zero history rows, no successful-update stamp, no
 * last_fetched_at stamp, and the job reports failure with the
 * validation detail. A valid response records exactly one point.
 * Serial vitest only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type FakeRow = Record<string, unknown>;

const state = vi.hoisted(() => ({
  sources: [] as FakeRow[],
  historyRows: [] as FakeRow[],
  inserts: [] as FakeRow[],
  sourceUpdates: [] as FakeRow[],
  fetchPayload: null as unknown,
  markUpdatedCalls: [] as string[],
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      let patch: FakeRow = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.is = () => chain;
      chain.order = () => chain;
      chain.limit = () => chain;
      chain.update = (p: FakeRow) => {
        patch = p;
        return chain;
      };
      chain.insert = async (row: FakeRow) => {
        if (table === 'price_history') state.inserts.push(row);
        return { error: null };
      };
      chain.maybeSingle = async () => {
        if (table === 'retailers') return { data: { slug: 'amazon' }, error: null };
        return { data: null, error: null };
      };
      chain.then = (
        onFulfilled: (v: { data: FakeRow[] | null; error: unknown }) => unknown,
        onRejected?: (e: unknown) => unknown
      ) => {
        if (Object.keys(patch).length > 0) {
          state.sourceUpdates.push({ table, ...patch });
          return Promise.resolve({ data: [], error: null }).then(
            onFulfilled as never,
            onRejected as never
          );
        }
        const data = table === 'product_sources' ? state.sources : state.historyRows;
        return Promise.resolve({ data, error: null }).then(
          onFulfilled as never,
          onRejected as never
        );
      };
      return chain;
    },
  }),
}));

vi.mock('@/services/providers', () => ({
  getProviderRegistry: () => ({
    get: (key: string) => (key === 'csv' ? { key: 'csv' } : undefined),
  }),
  callProviderFetch: async () => state.fetchPayload,
  callProviderSearch: vi.fn(async () => []),
}));

vi.mock('@/services/visual-search', () => ({
  captionPublicImageUrl: vi.fn(async () => null),
  embedText: vi.fn(async () => null),
  embedTextClip: vi.fn(async () => null),
  searchVisualByImageUrl: vi.fn(async () => []),
}));

vi.mock('@/services/ai-engine/health-report', () => ({
  reportAiProviderHealth: vi.fn(async () => undefined),
  reportProviderSyncHistory: vi.fn(async () => undefined),
}));

vi.mock('@/services/data-sources', () => ({
  recordDataSourceSync: vi.fn(async () => undefined),
}));

vi.mock('@/lib/cache/ai-invalidation', () => ({
  invalidateAiForProduct: vi.fn(async () => undefined),
}));

vi.mock('@/services/provider-rate-limits', () => ({
  acquireProviderFetchSlot: vi.fn(async () => ({ waitedMs: 0 })),
}));

vi.mock('@/services/last-successful-update', () => ({
  markProductSuccessfullyUpdated: vi.fn(async (_supabase: unknown, productId: string) => {
    state.markUpdatedCalls.push(productId);
    return { persisted: true };
  }),
}));

import { processors } from '@/lib/workers/processors';

const VALID_PAYLOAD = {
  externalId: 'B0EXAMPLE',
  retailerSlug: 'amazon',
  name: 'MacBook Air 13',
  price: 899,
  currency: 'USD',
  availability: 'in_stock' as const,
};

function resetState() {
  state.sources = [
    {
      id: 'src-1',
      product_id: 'p-1',
      retailer_id: 'r-amazon',
      external_id: 'B0EXAMPLE',
      provider_key: 'csv',
      last_fetched_at: null,
    },
  ];
  state.historyRows = [];
  state.inserts = [];
  state.sourceUpdates = [];
  state.markUpdatedCalls = [];
  state.fetchPayload = VALID_PAYLOAD;
}

describe('F-P2-20 invalid provider response — provider output to price_history', () => {
  beforeEach(() => {
    resetState();
  });

  it('a valid provider response records exactly one history point', async () => {
    const result = await processors['price.refresh']({
      type: 'price.refresh',
      data: { productId: 'p-1' },
    });
    expect(result.success).toBe(true);
    expect(result.processed).toBe(1);
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]).toMatchObject({
      product_id: 'p-1',
      retailer_id: 'r-amazon',
      price: 899,
      currency: 'USD',
      source: 'merchant-feed',
    });
    expect(state.markUpdatedCalls).toEqual(['p-1']);
    expect(
      state.sourceUpdates.some((u) => u.table === 'product_sources' && 'last_fetched_at' in u)
    ).toBe(true);
  });

  it('a negative price is rejected: zero rows, no stamp, job fails', async () => {
    state.fetchPayload = { ...VALID_PAYLOAD, price: -5 };
    const result = await processors['price.refresh']({
      type: 'price.refresh',
      data: { productId: 'p-1' },
    });
    expect(result.success).toBe(false);
    expect(result.processed).toBe(0);
    expect(result.errors?.join(' ')).toMatch(/invalid data/i);
    expect(state.inserts).toHaveLength(0);
    expect(state.markUpdatedCalls).toHaveLength(0);
    expect(state.sourceUpdates).toHaveLength(0);
  });

  it('a missing price is rejected, never stored', async () => {
    const { price: _price, ...noPrice } = VALID_PAYLOAD;
    state.fetchPayload = noPrice;
    const result = await processors['price.refresh']({
      type: 'price.refresh',
      data: { productId: 'p-1' },
    });
    expect(result.success).toBe(false);
    expect(result.processed).toBe(0);
    expect(result.errors?.join(' ')).toMatch(/invalid data/i);
    expect(state.inserts).toHaveLength(0);
    expect(state.markUpdatedCalls).toHaveLength(0);
  });

  it('an invalid GTIN is rejected, never stored', async () => {
    state.fetchPayload = { ...VALID_PAYLOAD, gtin: '1234567890123' };
    const result = await processors['price.refresh']({
      type: 'price.refresh',
      data: { productId: 'p-1' },
    });
    expect(result.success).toBe(false);
    expect(result.processed).toBe(0);
    expect(result.errors?.join(' ')).toMatch(/invalid data/i);
    expect(state.inserts).toHaveLength(0);
    expect(state.markUpdatedCalls).toHaveLength(0);
  });

  it('a missing product name is rejected, never stored', async () => {
    state.fetchPayload = { ...VALID_PAYLOAD, name: '' };
    const result = await processors['price.refresh']({
      type: 'price.refresh',
      data: { productId: 'p-1' },
    });
    expect(result.success).toBe(false);
    expect(result.processed).toBe(0);
    expect(state.inserts).toHaveLength(0);
  });
});
