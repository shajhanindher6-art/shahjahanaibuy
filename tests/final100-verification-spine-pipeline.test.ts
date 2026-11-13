/**
 * FINAL 100% Product & Real Data Completion — W1 verification spine,
 * pipeline leg (F-P0-02).
 *
 * The pipeline refresh leg (`refreshPricesViaPipeline`) re-fetches
 * through the `price.refresh` processor. When the processor saved
 * a validated provider response, the PRODUCTS row itself must be
 * re-verified — the same live check that moves `data_freshness`
 * must also move the verification stamp. Serial vitest only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  processor: vi.fn(),
  getAvailable: vi.fn(() => [{ key: 'csv' }]),
}));

vi.mock('@/services/providers', () => ({
  getProviderRegistry: () => ({
    getAvailable: mocks.getAvailable,
    getAll: () => [],
  }),
}));

vi.mock('@/lib/workers/processors', () => ({
  processors: {
    'price.refresh': (...args: unknown[]) => mocks.processor(...args),
  },
}));

import { refreshPricesViaPipeline } from '@/services/pipeline-refresh';

type FakeRow = Record<string, unknown>;

function pipelineFakeClient(opts: { failVerificationUpdate?: boolean } = {}) {
  const updates: Array<{ table: string; patch: FakeRow }> = [];
  const dueRows: FakeRow[] = [
    { id: 'p-1', slug: 'macbook-air-13', next_refresh_at: '2026-11-01T00:00:00.000Z' },
  ];
  const client = {
    updates,
    from(table: string) {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.is = () => chain;
      chain.lte = () => chain;
      chain.order = () => chain;
      chain.limit = () => chain;
      chain.eq = () => chain;
      chain.update = (patch: FakeRow) => {
        updates.push({ table, patch });
        return chain;
      };
      chain.then = (
        onFulfilled: (v: { data: FakeRow[] | null; error: unknown }) => unknown,
        onRejected?: (e: unknown) => unknown
      ) => {
        const lastUpdate = updates[updates.length - 1];
        if (
          opts.failVerificationUpdate &&
          lastUpdate &&
          'price_verification_status' in lastUpdate.patch
        ) {
          return Promise.resolve({
            data: null,
            error: { code: '42703', message: 'column does not exist' },
          }).then(onFulfilled as never, onRejected as never);
        }
        return Promise.resolve({ data: dueRows, error: null }).then(
          onFulfilled as never,
          onRejected as never
        );
      };
      return chain;
    },
  };
  return client;
}

describe('F-P0-02 refreshPricesViaPipeline — the products-row rollup', () => {
  beforeEach(() => {
    mocks.processor.mockReset();
    mocks.processor.mockResolvedValue({ success: true, processed: 1 });
  });

  it('a successful provider re-fetch stamps the PRODUCTS row verified', async () => {
    const client = pipelineFakeClient();
    const r = await refreshPricesViaPipeline(client as never);
    expect(r.available).toBe(true);
    expect(r.checked).toBe(1);
    expect(r.refreshed).toBe(1);
    expect(r.failed).toBe(0);
    const freshnessStamp = client.updates.find((u) => 'data_freshness' in u.patch);
    expect(freshnessStamp).toBeDefined();
    const verificationStamp = client.updates.find(
      (u) => u.patch.price_verification_status === 'verified'
    );
    expect(verificationStamp).toBeDefined();
    expect(verificationStamp?.table).toBe('products');
    expect(typeof verificationStamp?.patch.price_verified_at).toBe('string');
    expect(
      Number.isFinite(new Date(verificationStamp?.patch.price_verified_at as string).getTime())
    ).toBe(true);
  });

  it('a 42703 (migration 045 unapplied) never fails the product — the stamp is skipped', async () => {
    const client = pipelineFakeClient({ failVerificationUpdate: true });
    const r = await refreshPricesViaPipeline(client as never);
    expect(r.refreshed).toBe(1);
    expect(r.failed).toBe(0);
    expect(client.updates.some((u) => 'data_freshness' in u.patch)).toBe(true);
  });

  it('a processor that refreshes nothing stamps nothing', async () => {
    mocks.processor.mockResolvedValue({ success: true, processed: 0 });
    const client = pipelineFakeClient();
    const r = await refreshPricesViaPipeline(client as never);
    expect(r.refreshed).toBe(0);
    expect(r.failed).toBe(1);
    expect(client.updates).toHaveLength(0);
  });
});
