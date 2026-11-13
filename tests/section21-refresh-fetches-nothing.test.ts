/**
 * Sections 21–25, Stage K (K10) — refresh-fetches-nothing tests.
 *
 * The live truth this file pins (service level, no network, no DB
 * writes — the Supabase client is a counting fake, the provider
 * registry and the `price.refresh` processor are mocked the way
 * tests/section17-stage-c.test.ts already does):
 *
 *   (a) With no provider configured, the pipeline refresh leg
 *       reports the code's real no-provider state — NOT an invented
 *       phrase. There is NO "waiting for an authorized data source"
 *       string anywhere in the codebase (verified by grep); the
 *       real wording is `available: false` +
 *       `reason: 'no-available-provider'` + the error sentence
 *       'No provider is available (CsvProvider needs CSV_SOURCE_URL;
 *       Amazon/Best Buy need their keys; Apify is fail-closed
 *       without its vars; Mock is never registered in production;
 *       eBay lives outside the registry).' — asserted verbatim
 *       below, plus each registered provider's real
 *       NOT_CONFIGURED reason (imported from the provider files,
 *       not copied).
 *   (b) A no-provider / error / empty refresh does NOT count as a
 *       successful refresh: `refreshed` stays 0, the
 *       `price.refresh` processor is never called (no-provider) or
 *       its empty/error result is counted as failed, and the
 *       refresh path issues ZERO `products` writes — so neither
 *       `data_freshness` (markProductRefreshed) nor
 *       `last_successful_update` (markProductSuccessfullyUpdated,
 *       services/last-successful-update.ts) can move. The stamp
 *       itself is pinned by contract: it writes ONLY via a
 *       `products.update({ last_successful_update })`, persists
 *       only on a successful update, and answers
 *       `{ persisted: false, reason: 'column-missing' }` while
 *       migration 066 is unapplied — never a fallback stamp.
 *   (c) A provider that errors, throws, or returns success with
 *       zero processed rows likewise refreshes nothing.
 *
 * FIXED (K10b, route level — FINAL 100%, W1, F-P1-28): the
 * refresh ROUTE (app/api/v1/prices/refresh/route.ts) no longer
 * records a no-provider run as 'completed'. The overall status
 * now comes from `resolveRefreshRunStatus`
 * (services/refresh-run.ts): zero failed steps + zero live prices
 * fetched = 'completed_no_live_source', and the response carries
 * `status` + `livePricesFetched` so /status can render it
 * honestly. The old computation ("no failed steps → 'completed'")
 * is gone — the route source pins below assert the resolver, the
 * new status value, and the response fields. Migration 040's
 * CHECK was widened in the (still unapplied) file so the new
 * status can be stored when the owner applies it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnySupabaseClient } from '@/lib/supabase/types';
import { CSV_NOT_CONFIGURED_REASON } from '@/services/providers/csv-provider';
import { AMAZON_NOT_CONFIGURED_REASON } from '@/services/providers/amazon-provider';
import { BESTBUY_NOT_CONFIGURED_REASON } from '@/services/providers/bestbuy-provider';
import { APIFY_NOT_CONFIGURED_REASON } from '@/services/providers/apify-provider';
import {
  LAST_SUCCESSFUL_UPDATE_COLUMN,
  markProductSuccessfullyUpdated,
  resolveLastSuccessfulUpdate,
} from '@/services/last-successful-update';
import { runRefreshStep } from '@/services/refresh-run';

function readRepo(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

// Section 20 pattern: csv-provider imports the visual-search SSRF
// guard; mock it so this file stays hermetic (only the reason
// constant is used here, never a fetch).
vi.mock('@/services/visual-search', () => ({
  isSafePublicImageUrl: async () => true,
}));

const mockRegistry = vi.hoisted(() => ({
  available: [] as Array<{ key: string }>,
  all: [] as Array<{
    name: string;
    getNotConfiguredReason: () => string | null;
  }>,
}));
const mockProcessor = vi.hoisted(() => ({
  fn: vi.fn(),
}));

vi.mock('@/services/providers', () => ({
  getProviderRegistry: () => ({
    getAvailable: () => mockRegistry.available,
    getAll: () => mockRegistry.all,
  }),
}));

vi.mock('@/lib/workers/processors', () => ({
  processors: {
    'price.refresh': (...args: unknown[]) => mockProcessor.fn(...args),
  },
}));

/** The exact no-provider error sentence from services/pipeline-refresh.ts. */
const NO_PROVIDER_ERROR =
  'No provider is available (CsvProvider needs CSV_SOURCE_URL; Amazon/Best Buy need their keys; Apify is fail-closed without its vars; Mock is never registered in production; eBay lives outside the registry).';

const UNCONFIGURED_ALL = [
  { name: 'csv', getNotConfiguredReason: () => CSV_NOT_CONFIGURED_REASON },
  {
    name: 'amazon',
    getNotConfiguredReason: () => AMAZON_NOT_CONFIGURED_REASON,
  },
  {
    name: 'bestbuy',
    getNotConfiguredReason: () => BESTBUY_NOT_CONFIGURED_REASON,
  },
  {
    name: 'apify',
    getNotConfiguredReason: () => APIFY_NOT_CONFIGURED_REASON,
  },
];

interface UpdateCall {
  table: string;
  payload: Record<string, unknown>;
}

/**
 * Counting fake Supabase client. Records every `from(table)` and
 * every `update(payload)` so the tests can prove a refresh path
 * issued ZERO writes (no stamp possible) — or exactly the one
 * write a genuine success issues. The due-products select resolves
 * the given rows; an update resolves `{ error }` from
 * `updateError` (null = success).
 */
function countingClient(
  dueRows: Array<{ id: string }>,
  opts: { updateError?: { code?: string; message?: string } | null } = {}
) {
  const calls = { from: [] as string[], updates: [] as UpdateCall[] };
  const updateError = opts.updateError ?? null;
  let currentTable = '';
  let mode: 'select' | 'update' | null = null;
  const chain: Record<string, unknown> = {};
  chain.select = () => {
    mode = 'select';
    return chain;
  };
  chain.is = () => chain;
  chain.lte = () => chain;
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.eq = () => chain;
  chain.update = (payload: Record<string, unknown>) => {
    mode = 'update';
    calls.updates.push({ table: currentTable, payload });
    return chain;
  };
  chain.then = (resolve: (value: unknown) => void) => {
    if (mode === 'update') resolve({ data: null, error: updateError });
    else resolve({ data: dueRows, error: null });
  };
  const client = {
    from: (table: string) => {
      calls.from.push(table);
      currentTable = table;
      return chain;
    },
  } as unknown as AnySupabaseClient;
  return { client, calls };
}

beforeEach(() => {
  mockRegistry.available = [];
  mockRegistry.all = [];
  mockProcessor.fn.mockReset();
});

describe('no provider configured — the refresh fetches nothing (K10a)', () => {
  it('reports available:false + reason no-available-provider with the real wording', async () => {
    mockRegistry.all = UNCONFIGURED_ALL;
    const { refreshPricesViaPipeline } = await import(
      '@/services/pipeline-refresh'
    );
    const { client, calls } = countingClient([{ id: 'p-1' }]);
    const result = await refreshPricesViaPipeline(client);

    expect(result.available).toBe(false);
    expect(result.reason).toBe('no-available-provider');
    expect(result.checked).toBe(0);
    expect(result.refreshed).toBe(0);
    expect(result.failed).toBe(0);
    // The exact error sentence from the code — not invented copy.
    expect(result.errors[0]).toBe(NO_PROVIDER_ERROR);
    // …and the per-provider reasons, imported from the providers.
    expect(result.errors[1]).toContain(CSV_NOT_CONFIGURED_REASON);
    expect(result.errors[1]).toContain(AMAZON_NOT_CONFIGURED_REASON);
    expect(result.errors[1]).toContain(BESTBUY_NOT_CONFIGURED_REASON);
    expect(result.errors[1]).toContain(APIFY_NOT_CONFIGURED_REASON);
  });

  it('never calls the price.refresh processor and never even reads due products', async () => {
    mockRegistry.all = UNCONFIGURED_ALL;
    const { refreshPricesViaPipeline } = await import(
      '@/services/pipeline-refresh'
    );
    const { client, calls } = countingClient([{ id: 'p-1' }]);
    await refreshPricesViaPipeline(client);

    expect(mockProcessor.fn).not.toHaveBeenCalled();
    // The registry check returns before the due-products select:
    // no read, so no write and no stamp could follow.
    expect(calls.from).toHaveLength(0);
    expect(calls.updates).toHaveLength(0);
  });

  it('runRefreshStep records it as an honest skip — ok step, zero refreshed, never a success claim', async () => {
    mockRegistry.all = UNCONFIGURED_ALL;
    const { refreshPricesViaPipeline } = await import(
      '@/services/pipeline-refresh'
    );
    const { client, calls } = countingClient([{ id: 'p-1' }]);
    const zeroPipeline = {
      available: false,
      reason: 'no-available-provider',
      checked: 0,
      refreshed: 0,
      failed: 0,
      errors: [] as string[],
    };
    // No isFailed predicate — by design (route header): a skip is
    // not a failure. The outcome status is 'ok' but the RESULT
    // says available:false + refreshed:0, so 'ok' here means
    // "nothing to fetch", never "prices refreshed".
    const outcome = await runRefreshStep(
      'refreshPricesViaPipeline',
      () => refreshPricesViaPipeline(client),
      zeroPipeline
    );
    expect(outcome.status).toBe('ok');
    expect(outcome.result.available).toBe(false);
    expect(outcome.result.refreshed).toBe(0);
    expect(calls.updates).toHaveLength(0);
  });

  it('no successful update is recorded anywhere: last_successful_update stays null', async () => {
    mockRegistry.all = UNCONFIGURED_ALL;
    const { refreshPricesViaPipeline } = await import(
      '@/services/pipeline-refresh'
    );
    const { client, calls } = countingClient([{ id: 'p-1' }]);
    await refreshPricesViaPipeline(client);

    // Zero products writes on the refresh path, so the 066 stamp
    // could not have moved…
    expect(calls.updates).toHaveLength(0);
    // …and the reader agrees: with no stored value, no live
    // price-history row and no merchant sync, there is no
    // successful update to report.
    expect(
      resolveLastSuccessfulUpdate(null, null, null, false)
    ).toEqual({ at: null, source: null, columnMissing: false });
  });
});

describe('provider errors / empty results — likewise no successful refresh (K10c)', () => {
  it('a provider that errors on every product counts zero successes and stamps nothing', async () => {
    mockRegistry.available = [{ key: 'csv' }];
    mockProcessor.fn.mockResolvedValue({
      success: false,
      processed: 0,
      errors: ['fetch failed'],
    });
    const { refreshPricesViaPipeline } = await import(
      '@/services/pipeline-refresh'
    );
    const { client, calls } = countingClient([{ id: 'p-1' }, { id: 'p-2' }]);
    const result = await refreshPricesViaPipeline(client);

    expect(result.available).toBe(true);
    expect(result.checked).toBe(2);
    expect(result.refreshed).toBe(0);
    expect(result.failed).toBe(2);
    expect(result.errors.some((e) => e.includes('p-1'))).toBe(true);
    expect(result.errors.some((e) => e.includes('p-2'))).toBe(true);
    expect(mockProcessor.fn).toHaveBeenCalledTimes(2);
    // An error result never reaches markProductRefreshed.
    expect(calls.updates).toHaveLength(0);
    expect(
      resolveLastSuccessfulUpdate(null, null, null, false)
    ).toEqual({ at: null, source: null, columnMissing: false });
  });

  it('a provider that returns success with zero processed rows (empty result) refreshes nothing', async () => {
    mockRegistry.available = [{ key: 'csv' }];
    mockProcessor.fn.mockResolvedValue({ success: true, processed: 0 });
    const { refreshPricesViaPipeline } = await import(
      '@/services/pipeline-refresh'
    );
    const { client, calls } = countingClient([{ id: 'p-1' }, { id: 'p-2' }]);
    const result = await refreshPricesViaPipeline(client);

    // success:true alone is not a refresh — only success AND
    // processed > 0 counts (pipeline-refresh.ts). An empty result
    // lands in `failed` with 'price.refresh reported no fresh price'.
    expect(result.checked).toBe(2);
    expect(result.refreshed).toBe(0);
    expect(result.failed).toBe(2);
    expect(result.errors).toHaveLength(2);
    expect(calls.updates).toHaveLength(0);
  });

  it('a throwing processor fails the product, never the run, and stamps nothing', async () => {
    mockRegistry.available = [{ key: 'csv' }];
    mockProcessor.fn.mockRejectedValue(new Error('provider exploded'));
    const { refreshPricesViaPipeline } = await import(
      '@/services/pipeline-refresh'
    );
    const { client, calls } = countingClient([{ id: 'p-1' }]);
    const result = await refreshPricesViaPipeline(client);

    expect(result.checked).toBe(1);
    expect(result.refreshed).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain('provider exploded');
    expect(calls.updates).toHaveLength(0);
  });
});

describe('control: a genuine success DOES stamp — so the zero-write pins above are meaningful', () => {
  it('a validated provider save refreshes the product and moves the freshness + verification stamps', async () => {
    mockRegistry.available = [{ key: 'csv' }];
    mockProcessor.fn.mockResolvedValue({ success: true, processed: 1 });
    const { refreshPricesViaPipeline } = await import(
      '@/services/pipeline-refresh'
    );
    const { client, calls } = countingClient([{ id: 'p-1' }]);
    const result = await refreshPricesViaPipeline(client);

    expect(result.refreshed).toBe(1);
    expect(result.failed).toBe(0);
    // Exactly TWO products writes: markProductRefreshed
    // (data_freshness / next_refresh_at) AND the FINAL-100%
    // (F-P0-02) rollup markProductVerified (price_verification_
    // status 'verified' + price_verified_at) — the same live check
    // that moves freshness also re-verifies the products row.
    // The wrapper itself never writes last_successful_update —
    // that stamp lives inside the real `price.refresh` processor
    // (lib/workers/processors.ts:525), which is mocked here, so it
    // cannot appear on this path.
    expect(calls.updates).toHaveLength(2);
    expect(calls.updates[0].table).toBe('products');
    expect(calls.updates[0].payload).toHaveProperty('data_freshness');
    expect(calls.updates[0].payload).not.toHaveProperty(
      LAST_SUCCESSFUL_UPDATE_COLUMN
    );
    expect(calls.updates[1].table).toBe('products');
    expect(calls.updates[1].payload).toMatchObject({
      price_verification_status: 'verified',
    });
    expect(calls.updates[1].payload).toHaveProperty('price_verified_at');
    expect(calls.updates[1].payload).not.toHaveProperty(
      LAST_SUCCESSFUL_UPDATE_COLUMN
    );
  });
});

describe('markProductSuccessfullyUpdated contract — what stamps last_successful_update (K10b)', () => {
  it('persists only via a products.update of last_successful_update', async () => {
    const { client, calls } = countingClient([]);
    const result = await markProductSuccessfullyUpdated(client, 'p-1');

    expect(result).toEqual({ persisted: true });
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0].table).toBe('products');
    expect(Object.keys(calls.updates[0].payload)).toEqual([
      LAST_SUCCESSFUL_UPDATE_COLUMN,
    ]);
  });

  it('column-missing (42703, migration 066 unapplied) reports persisted:false and never falls back to another stamp', async () => {
    const { client, calls } = countingClient([], {
      updateError: { code: '42703', message: 'column does not exist' },
    });
    const result = await markProductSuccessfullyUpdated(client, 'p-1');

    expect(result).toEqual({ persisted: false, reason: 'column-missing' });
    // The one attempted write is the stamp itself; no second
    // write (e.g. onto data_freshness) is issued as a fallback.
    expect(calls.updates).toHaveLength(1);
    expect(Object.keys(calls.updates[0].payload)).toEqual([
      LAST_SUCCESSFUL_UPDATE_COLUMN,
    ]);
  });

  it('resolveLastSuccessfulUpdate: a live price-history row counts, a null/seed-style input does not', () => {
    expect(
      resolveLastSuccessfulUpdate(null, '2026-11-02T10:00:00.000Z', null, true)
    ).toEqual({
      at: '2026-11-02T10:00:00.000Z',
      source: 'price-history',
      columnMissing: true,
    });
    expect(
      resolveLastSuccessfulUpdate(null, 'not-a-date', null, false)
    ).toEqual({ at: null, source: null, columnMissing: false });
  });

  it('the wrapper never stamps last_successful_update itself (source pin)', () => {
    const wrapper = readRepo('services/pipeline-refresh.ts');
    expect(wrapper).not.toContain('markProductSuccessfullyUpdated');
    expect(wrapper).toContain('markProductRefreshed');
    // The stamp lives in the real price.refresh processor, after
    // a provider response was validated and its price_history row
    // inserted — not on the refresh wrapper path.
    const processors = readRepo('lib/workers/processors.ts');
    expect(processors).toContain(
      'await markProductSuccessfullyUpdated(supabase, productId)'
    );
  });
});

describe('route-level overall status — the K10b fix (F-P1-28)', () => {
  it('a no-provider run is recorded as completed_no_live_source, never completed', () => {
    const route = readRepo('app/api/v1/prices/refresh/route.ts');
    // The pipeline step has no isFailed predicate (available:false
    // is a skip), so with every other step ok, failedSteps is
    // empty — but the run must NOT be called 'completed' when no
    // live price was fetched. The resolver distinguishes that:
    // zero live prices + zero failures = 'completed_no_live_source'.
    // A job must never be called successful when no provider data
    // was retrieved.
    expect(route).toContain("reason: 'no-available-provider'");
    expect(route).toContain('resolveRefreshRunStatus');
    expect(route).toContain('completed_no_live_source');
    expect(route).toContain('livePricesFetched');
    expect(route).toContain('status: overallStatus');
    expect(route).not.toContain("? 'completed'");
  });
});
