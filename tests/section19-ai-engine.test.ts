/**
 * Section 19, Phase 1 (§12 #1, #3, #4, #5, #6, #7, #8, #9, #13) —
 * AI Intelligence Engine tests.
 *
 * Covers: the provider registry (register/list/by-capability), the
 * engine's ordered fallback chain + `fallbackUsed` label, retry
 * with backoff honouring the `retryable` flag, in-memory usage /
 * latency tracking, the global daily provider budgets, the
 * per-user daily AI quota, `recordProviderHealth` wiring (called
 * on success AND on failure), SerpAPI/HF live-path behaviour
 * (retry, budget exhaustion), and health-endpoint provider
 * validation.
 *
 * Isolation: `resetAiUsage()` runs before each test (budgets,
 * quotas and circuit state are per-instance in-memory). The
 * engine tests use fresh registries, never the singleton.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env } from '@/lib/config/env';
import { AIEngineRegistry } from '@/services/ai-engine/registry';
import { AIEngine } from '@/services/ai-engine/engine';
import {
  ProviderSkippedError,
  type AICapability,
  type AIProvider,
} from '@/services/ai-engine/types';
import {
  recordAiCall,
  isAiCircuitOpen,
  checkAiUserQuota,
  spendProviderBudget,
  isProviderBudgetExhausted,
  getProviderBudgetState,
  getAiUsageSummary,
  resetAiUsage,
  AI_USER_DAILY_QUOTA,
} from '@/services/ai-engine/usage';
import { withAiRetry, isRetryableError } from '@/services/ai-engine/retry';
import { reportAiProviderHealth } from '@/services/ai-engine/health-report';
import { getAiEngine } from '@/services/ai-engine/providers';
import { searchWebProducts } from '@/services/external-search';
import { embedText } from '@/services/visual-search';
import { checkHealth } from '@/services/health';

function setEnvKey(key: 'serpApiKey' | 'hfApiToken', value: string | undefined): void {
  (env as unknown as Record<string, string | undefined>)[key] = value;
}

function fakeProvider(
  key: string,
  capabilities: AICapability[],
  invoke: AIProvider['invoke'],
  available = true
): AIProvider {
  return {
    key,
    name: `Test ${key}`,
    kind: 'deterministic',
    capabilities,
    description: 'test provider',
    isAvailable: () => available,
    availability: () => 'available',
    invoke,
  };
}

function serpApiShoppingResponse() {
  return {
    shopping_results: [
      {
        title: 'Test Phone',
        product_link: 'https://example.com/phone',
        extracted_price: 299,
        source: 'Test Store',
        thumbnail: 'https://example.com/thumb.jpg',
        rating: 4.5,
        reviews: 12,
      },
    ],
  };
}

/** Minimal fake Supabase client: external_search_cache miss + upsert no-op. */
function fakeSearchClient() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          gt: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        }),
      }),
      upsert: async () => ({ data: null, error: null }),
    }),
  } as unknown as Parameters<typeof searchWebProducts>[0];
}

/** Fake client capturing provider_health upserts for recordProviderHealth tests. */
function fakeHealthClient(captured: Array<Record<string, unknown>>) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
      upsert: async (row: Record<string, unknown>) => {
        captured.push(row);
        return { data: null, error: null };
      },
    }),
  } as unknown as Parameters<typeof reportAiProviderHealth>[0];
}

beforeEach(() => {
  resetAiUsage();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  setEnvKey('serpApiKey', undefined);
  setEnvKey('hfApiToken', undefined);
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe('AIEngineRegistry', () => {
  it('registers, lists, gets by key and by capability in registration order', () => {
    const registry = new AIEngineRegistry();
    const a = fakeProvider('a', ['search'], async () => 'a');
    const b = fakeProvider('b', ['search', 'web-search'], async () => 'b');
    registry.register(a);
    registry.register(b);
    expect(registry.get('a')).toBe(a);
    expect(registry.getAll().map((p) => p.key)).toEqual(['a', 'b']);
    expect(registry.getByCapability('search').map((p) => p.key)).toEqual(['a', 'b']);
    expect(registry.getByCapability('web-search').map((p) => p.key)).toEqual(['b']);
    expect(registry.getAvailable().map((p) => p.key)).toEqual(['a', 'b']);
    expect(registry.unregister('a')).toBe(true);
    expect(registry.get('a')).toBeUndefined();
  });

  it('getAvailable excludes unavailable providers', () => {
    const registry = new AIEngineRegistry();
    registry.register(fakeProvider('off', ['search'], async () => 'x', false));
    registry.register(fakeProvider('on', ['search'], async () => 'y', true));
    expect(registry.getAvailable().map((p) => p.key)).toEqual(['on']);
    expect(registry.getByCapability('search').map((p) => p.key)).toEqual(['off', 'on']);
  });
});

// ---------------------------------------------------------------------------
// Engine fallback chain + fallbackUsed
// ---------------------------------------------------------------------------

describe('AIEngine.invoke fallback chain', () => {
  it('serves from the primary provider with fallbackUsed:false', async () => {
    const registry = new AIEngineRegistry();
    registry.register(fakeProvider('primary', ['search'], async () => 'primary-value'));
    registry.register(fakeProvider('backup', ['search'], async () => 'backup-value'));
    const engine = new AIEngine(registry);
    const result = await engine.invoke<string>('search', {});
    expect(result.value).toBe('primary-value');
    expect(result.providerKey).toBe('primary');
    expect(result.fallbackUsed).toBe(false);
    expect(result.attemptedProviders).toEqual(['primary']);
    expect(typeof result.latencyMs).toBe('number');
  });

  it('falls back to the next provider on failure and labels fallbackUsed:true', async () => {
    const registry = new AIEngineRegistry();
    registry.register(
      fakeProvider('primary', ['search'], async () => {
        throw new Error('primary down');
      })
    );
    registry.register(fakeProvider('backup', ['search'], async () => 'backup-value'));
    const engine = new AIEngine(registry);
    const result = await engine.invoke<string>('search', {});
    expect(result.value).toBe('backup-value');
    expect(result.providerKey).toBe('backup');
    expect(result.fallbackUsed).toBe(true);
    expect(result.attemptedProviders).toEqual(['primary', 'backup']);
  });

  it('a ProviderSkippedError declines without counting as a failure (next provider serves)', async () => {
    const registry = new AIEngineRegistry();
    registry.register(
      fakeProvider('clip', ['visual-embed'], async () => {
        throw new ProviderSkippedError('no CLIP rows');
      })
    );
    registry.register(fakeProvider('minilm', ['visual-embed'], async () => [0.1, 0.2]));
    const engine = new AIEngine(registry);
    const result = await engine.invoke<number[]>('visual-embed', { text: 'x', preferClip: false });
    expect(result.providerKey).toBe('minilm');
    expect(result.fallbackUsed).toBe(true);
    expect(result.attemptedProviders).toEqual(['clip', 'minilm']);
  });

  it('throws when every provider fails, and skips unavailable providers', async () => {
    const registry = new AIEngineRegistry();
    registry.register(fakeProvider('off', ['search'], async () => 'never', false));
    registry.register(
      fakeProvider('down', ['search'], async () => {
        throw new Error('boom');
      })
    );
    const engine = new AIEngine(registry);
    await expect(engine.invoke<string>('search', {})).rejects.toThrow('boom');
  });

  it('throws NoAiProviderAvailableError when no provider serves the capability', async () => {
    const registry = new AIEngineRegistry();
    registry.register(fakeProvider('a', ['search'], async () => 'a'));
    const engine = new AIEngine(registry);
    await expect(engine.invoke<string>('web-search', {})).rejects.toThrow(
      /No available AI provider/
    );
  });

  it('skips a circuit-open provider (5 consecutive failures) and falls back', async () => {
    const registry = new AIEngineRegistry();
    registry.register(fakeProvider('flaky', ['search'], async () => 'flaky-value'));
    registry.register(fakeProvider('steady', ['search'], async () => 'steady-value'));
    for (let i = 0; i < 5; i++) {
      recordAiCall('flaky', { success: false, latencyMs: 10 });
    }
    expect(isAiCircuitOpen('flaky')).toBe(true);
    const engine = new AIEngine(registry);
    const result = await engine.invoke<string>('search', {});
    expect(result.providerKey).toBe('steady');
    expect(result.fallbackUsed).toBe(true);
    expect(result.attemptedProviders).toEqual(['steady']);
  });

  it('records per-capability latency for the admin summary', async () => {
    const registry = new AIEngineRegistry();
    registry.register(fakeProvider('a', ['search'], async () => 'v'));
    const engine = new AIEngine(registry);
    await engine.invoke<string>('search', {});
    const summary = getAiUsageSummary();
    const cap = summary.capabilities.find((c) => c.capability === 'search');
    expect(cap?.calls).toBe(1);
    expect(cap?.success).toBe(1);
    expect(typeof cap?.avgLatencyMs).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

describe('withAiRetry', () => {
  it('retries a retryable failure and returns the eventual success', async () => {
    let calls = 0;
    const value = await withAiRetry(
      async () => {
        calls++;
        if (calls < 3) {
          const err = new Error('model loading') as Error & { retryable: boolean };
          err.retryable = true;
          throw err;
        }
        return 'ok';
      },
      { baseDelayMs: 1 }
    );
    expect(value).toBe('ok');
    expect(calls).toBe(3);
  });

  it('does not retry a non-retryable failure', async () => {
    let calls = 0;
    await expect(
      withAiRetry(
        async () => {
          calls++;
          throw new Error('bad key');
        },
        { baseDelayMs: 1 }
      )
    ).rejects.toThrow('bad key');
    expect(calls).toBe(1);
  });

  it('gives up after maxAttempts and rethrows the last error', async () => {
    let calls = 0;
    await expect(
      withAiRetry(
        async () => {
          calls++;
          const err = new Error('still loading') as Error & { retryable: boolean };
          err.retryable = true;
          throw err;
        },
        { maxAttempts: 2, baseDelayMs: 1 }
      )
    ).rejects.toThrow('still loading');
    expect(calls).toBe(2);
  });

  it('retries when shouldRetryResult matches (e.g. HTTP 503)', async () => {
    let calls = 0;
    const res = await withAiRetry(
      async () => {
        calls++;
        return { status: calls < 2 ? 503 : 200 };
      },
      { baseDelayMs: 1, shouldRetryResult: (r) => r.status === 503 }
    );
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });

  it('isRetryableError honours the flag, 429/5xx, and network failures — never 401', () => {
    expect(isRetryableError(Object.assign(new Error('x'), { retryable: true }))).toBe(true);
    expect(isRetryableError(Object.assign(new Error('x'), { retryable: false }))).toBe(false);
    expect(isRetryableError(Object.assign(new Error('x'), { status: 503 }))).toBe(true);
    expect(isRetryableError(Object.assign(new Error('x'), { status: 429 }))).toBe(true);
    expect(isRetryableError(Object.assign(new Error('x'), { status: 401 }))).toBe(false);
    expect(isRetryableError(new Error('fetch failed'))).toBe(true);
    expect(isRetryableError(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Usage / budgets / per-user quota / latency
// ---------------------------------------------------------------------------

describe('AI usage, budgets and per-user quota', () => {
  it('recordAiCall aggregates calls, success/failure and average latency', () => {
    recordAiCall('serpapi', { success: true, latencyMs: 100 });
    recordAiCall('serpapi', { success: true, latencyMs: 200 });
    recordAiCall('serpapi', { success: false, latencyMs: 50 });
    const summary = getAiUsageSummary();
    const entry = summary.providers.find((p) => p.key === 'serpapi');
    expect(entry?.calls).toBe(3);
    expect(entry?.success).toBe(2);
    expect(entry?.failure).toBe(1);
    expect(entry?.avgLatencyMs).toBe(117); // (100+200+50)/3 rounded
    expect(entry?.consecutiveFailures).toBe(1);
  });

  it('opens the circuit after 5 consecutive failures and closes it on success', () => {
    for (let i = 0; i < 4; i++) {
      recordAiCall('huggingface', { success: false, latencyMs: 5 });
    }
    expect(isAiCircuitOpen('huggingface')).toBe(false);
    recordAiCall('huggingface', { success: false, latencyMs: 5 });
    expect(isAiCircuitOpen('huggingface')).toBe(true);
    recordAiCall('huggingface', { success: true, latencyMs: 5 });
    expect(isAiCircuitOpen('huggingface')).toBe(false);
  });

  it('SerpAPI daily budget (5) exhausts after 5 spends; the 6th spend is refused', () => {
    expect(getProviderBudgetState('serpapi').budget).toBe(5);
    for (let i = 0; i < 5; i++) {
      expect(spendProviderBudget('serpapi')).toBe(true);
    }
    expect(isProviderBudgetExhausted('serpapi')).toBe(true);
    expect(spendProviderBudget('serpapi')).toBe(false);
    expect(getProviderBudgetState('serpapi').remaining).toBe(0);
  });

  it('per-user daily quota allows 300 calls, then denies with a reset time', () => {
    const user = 'user-quota-test';
    for (let i = 0; i < AI_USER_DAILY_QUOTA; i++) {
      expect(checkAiUserQuota(user).allowed).toBe(true);
    }
    const denied = checkAiUserQuota(user);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(typeof denied.resetAt).toBe('string');
    // A different user still has their own budget.
    expect(checkAiUserQuota('another-user').allowed).toBe(true);
  });

  it('getAiUsageSummary documents the in-memory limitation honestly', () => {
    const summary = getAiUsageSummary();
    expect(summary.note).toMatch(/In-memory/);
    expect(summary.budgets.map((b) => b.key)).toEqual(
      expect.arrayContaining(['serpapi', 'huggingface'])
    );
  });
});

// ---------------------------------------------------------------------------
// recordProviderHealth wiring
// ---------------------------------------------------------------------------

describe('reportAiProviderHealth (§12 #8)', () => {
  it('writes a success row (success_count 1, consecutive_failures 0)', async () => {
    const captured: Array<Record<string, unknown>> = [];
    await reportAiProviderHealth(fakeHealthClient(captured), 'serpapi', {
      success: true,
      responseMs: 123,
    });
    expect(captured).toHaveLength(1);
    expect(captured[0].provider_key).toBe('serpapi');
    expect(captured[0].success_count).toBe(1);
    expect(captured[0].consecutive_failures).toBe(0);
    expect(captured[0].avg_response_ms).toBe(123);
  });

  it('writes a failure row (failure_count 1, consecutive_failures 1, error kept)', async () => {
    const captured: Array<Record<string, unknown>> = [];
    await reportAiProviderHealth(fakeHealthClient(captured), 'huggingface', {
      success: false,
      responseMs: 45,
      error: 'SerpAPI HTTP 503',
    });
    expect(captured).toHaveLength(1);
    expect(captured[0].failure_count).toBe(1);
    expect(captured[0].consecutive_failures).toBe(1);
    expect(captured[0].last_error).toBe('SerpAPI HTTP 503');
  });

  it('never throws — a failing client or a null client is swallowed', async () => {
    const throwing = {
      from: () => {
        throw new Error('db down');
      },
    } as unknown as Parameters<typeof reportAiProviderHealth>[0];
    await expect(
      reportAiProviderHealth(throwing, 'serpapi', { success: true })
    ).resolves.toBeUndefined();
    await expect(reportAiProviderHealth(null, 'serpapi', { success: true })).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SerpAPI live path (searchWebProducts): retry + budget
// ---------------------------------------------------------------------------

describe('searchWebProducts (§12 #6, #7, #8, #9)', () => {
  it('live fetch succeeds, records usage, and is not budget-exhausted', async () => {
    setEnvKey('serpApiKey', 'test-serpapi-key');
    let fetchCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        fetchCalls++;
        return { ok: true, status: 200, json: async () => serpApiShoppingResponse() };
      })
    );
    const out = await searchWebProducts(fakeSearchClient(), 'budget-test-phone-a', 10);
    expect(out.disabled).toBe(false);
    expect(out.budgetExhausted).toBe(false);
    expect(out.results).toHaveLength(1);
    expect(out.results[0].title).toBe('Test Phone');
    expect(fetchCalls).toBe(1);
    const summary = getAiUsageSummary();
    expect(summary.providers.find((p) => p.key === 'serpapi')?.success).toBe(1);
  });

  it('retries a 503 then succeeds (fetch called twice, one logical call)', async () => {
    setEnvKey('serpApiKey', 'test-serpapi-key');
    let fetchCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        fetchCalls++;
        if (fetchCalls === 1) return { ok: false, status: 503, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => serpApiShoppingResponse() };
      })
    );
    const out = await searchWebProducts(fakeSearchClient(), 'budget-test-phone-b', 10);
    expect(out.results).toHaveLength(1);
    expect(fetchCalls).toBe(2);
    // One logical call spends one budget unit, not two.
    expect(getProviderBudgetState('serpapi').used).toBe(1);
  });

  it('does not retry a 401 (bad key) — returns empty immediately', async () => {
    setEnvKey('serpApiKey', 'test-serpapi-key');
    let fetchCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        fetchCalls++;
        return { ok: false, status: 401, json: async () => ({}) };
      })
    );
    const out = await searchWebProducts(fakeSearchClient(), 'budget-test-phone-c', 10);
    expect(out.results).toEqual([]);
    expect(fetchCalls).toBe(1);
  });

  it('returns budgetExhausted:true without fetching once the daily budget is spent', async () => {
    setEnvKey('serpApiKey', 'test-serpapi-key');
    for (let i = 0; i < 5; i++) spendProviderBudget('serpapi');
    let fetchCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        fetchCalls++;
        return { ok: true, status: 200, json: async () => serpApiShoppingResponse() };
      })
    );
    const out = await searchWebProducts(fakeSearchClient(), 'budget-test-phone-d', 10);
    expect(out.budgetExhausted).toBe(true);
    expect(out.results).toEqual([]);
    expect(fetchCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Hugging Face live path (embedText): retry + budget
// ---------------------------------------------------------------------------

describe('embedText via hfFetch (§12 #6, #7)', () => {
  it('retries 503s (model loading) then succeeds with the vector', async () => {
    setEnvKey('hfApiToken', 'test-hf-token');
    const vector = new Array(384).fill(0.01);
    let fetchCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        fetchCalls++;
        if (fetchCalls <= 2) return new Response('model loading', { status: 503 });
        return new Response(JSON.stringify(vector), { status: 200 });
      })
    );
    const result = await embedText('a laptop');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(vector);
    expect(fetchCalls).toBe(3);
  });

  it('returns a budget error without fetching once the HF daily budget is spent', async () => {
    setEnvKey('hfApiToken', 'test-hf-token');
    for (let i = 0; i < 50; i++) spendProviderBudget('huggingface');
    let fetchCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        fetchCalls++;
        return new Response(JSON.stringify(new Array(384).fill(0)), { status: 200 });
      })
    );
    // Section 19, Phase 8 (§12 #11) — this test must embed a text
    // never embedded before in this file: the visual-search cache
    // serves earlier successes without spending budget (same order
    // as the SerpAPI 2-tier cache: cache first, budget check only
    // on a miss), so re-using 'a laptop' from the test above would
    // return its cached vector instead of the budget error.
    const result = await embedText('a laptop never embedded before');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(false);
      expect(result.error).toMatch(/budget/i);
    }
    expect(fetchCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Provider validation + health endpoint
// ---------------------------------------------------------------------------

describe('provider validation (§12 #3)', () => {
  it('deterministic providers are available; live providers are disabled without keys', () => {
    delete process.env.SERPAPI_API_KEY;
    delete process.env.HF_API_TOKEN;
    const statuses = getAiEngine().validate();
    const byKey = new Map(statuses.map((s) => [s.key, s]));
    expect(byKey.get('ai-search')?.status).toBe('available');
    expect(byKey.get('ai-search')?.available).toBe(true);
    expect(byKey.get('serpapi')?.status).toBe('disabled');
    expect(byKey.get('serpapi')?.available).toBe(false);
    expect(byKey.get('huggingface-clip')?.status).toBe('disabled');
    expect(byKey.get('serpapi')?.detail).toMatch(/Not configured/);
  });

  it('a configured live key reports available-unverified (key presence only, never probed)', () => {
    vi.stubEnv('SERPAPI_API_KEY', 'test-key');
    const statuses = getAiEngine().validate();
    const serpapi = statuses.find((s) => s.key === 'serpapi');
    expect(serpapi?.available).toBe(true);
    expect(serpapi?.status).toBe('available-unverified');
    expect(serpapi?.detail).toMatch(/NOT probed/);
  });

  it('checkHealth surfaces AI provider status without changing overall health', async () => {
    delete process.env.SERPAPI_API_KEY;
    delete process.env.HF_API_TOKEN;
    const supabase = {
      from: () => ({
        select: () => ({
          limit: async () => ({ error: null }),
        }),
      }),
      auth: {
        getUser: async () => ({ data: { user: null }, error: null }),
      },
    } as unknown as Parameters<typeof checkHealth>[0];
    const health = await checkHealth(supabase);
    expect(health.checks.database.status).toBe('up');
    expect(health.ai).toBeDefined();
    const byKey = new Map((health.ai?.providers ?? []).map((s) => [s.key, s]));
    expect(byKey.get('ai-search')?.status).toBe('available');
    expect(byKey.get('serpapi')?.status).toBe('disabled');
    // AI status is informational only: auth-down still drives the
    // overall status, AI never flips it.
    expect(health.status).toBe('degraded');
  });
});
