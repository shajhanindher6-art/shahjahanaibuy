/**
 * Section 19, Phase 8 (§12 #11) — visual-search result cache tests.
 *
 * - Second identical scan → cache hit, no new provider call (Lens,
 *   caption, MiniLM embed, CLIP embed).
 * - A cache hit returns the same result shape as a fresh analysis,
 *   labelled as cached (`cached: true` / `fromCache: true` +
 *   `fetchedAt`) — never presented as freshly computed.
 * - A different input misses the cache and fetches again.
 * - Failures are never cached (a failed Lens call fetches again).
 * - Budget gating is preserved: a cache hit spends no SerpAPI/HF
 *   budget; a miss goes through the existing budget check (the
 *   engine tests cover budget exhaustion itself).
 *
 * Isolation: `resetAiUsage()` before each test (budgets are
 * per-instance in-memory) + `clearVisualSearchCache()`. The caption
 * test uses a literal public IP URL (8.8.8.8) so the SSRF guard
 * passes without a DNS lookup in the sandbox.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env } from '@/lib/config/env';
import { resetAiUsage, getProviderBudgetState } from '@/services/ai-engine/usage';
import {
  searchVisualByImageUrl,
  searchVisualByImageUrlWithMeta,
  captionPublicImageUrl,
  embedText,
  embedTextClip,
  clearVisualSearchCache,
  getVisualSearchCacheSize,
} from '@/services/visual-search';

function setEnvKey(key: 'serpApiKey' | 'hfApiToken', value: string | undefined): void {
  (env as unknown as Record<string, string | undefined>)[key] = value;
}

beforeEach(() => {
  resetAiUsage();
  clearVisualSearchCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  setEnvKey('serpApiKey', undefined);
  setEnvKey('hfApiToken', undefined);
});

describe('visual-search Lens cache (§12 #11)', () => {
  it('second identical scan is a cache hit with no new SerpAPI call', async () => {
    setEnvKey('serpApiKey', 'test-serpapi-key');
    let fetchCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        fetchCalls++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            visual_matches: [
              { title: 'Test Phone', source: 'Test Store', link: 'https://example.com/p', thumbnail: null },
            ],
          }),
        };
      })
    );

    const first = await searchVisualByImageUrlWithMeta('https://example.com/phone.jpg');
    expect(first.fromCache).toBe(false);
    expect(first.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(first.matches).toHaveLength(1);
    expect(first.matches[0].title).toBe('Test Phone');
    expect(fetchCalls).toBe(1);
    // One live Lens call spent one unit of the daily SerpAPI budget.
    expect(getProviderBudgetState('serpapi').used).toBe(1);

    const second = await searchVisualByImageUrlWithMeta('https://example.com/phone.jpg');
    expect(second.fromCache).toBe(true);
    expect(second.fetchedAt).toBe(first.fetchedAt);
    expect(second.matches).toEqual(first.matches);
    expect(fetchCalls).toBe(1);
    // The cache hit spent no further budget.
    expect(getProviderBudgetState('serpapi').used).toBe(1);

    // The plain wrapper keeps the old shape (VisualMatch[]).
    const plain = await searchVisualByImageUrl('https://example.com/phone.jpg');
    expect(plain).toEqual(first.matches);
    expect(fetchCalls).toBe(1);
  });

  it('a different image URL misses the cache and fetches again', async () => {
    setEnvKey('serpApiKey', 'test-serpapi-key');
    let fetchCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        fetchCalls++;
        return { ok: true, status: 200, json: async () => ({ visual_matches: [] }) };
      })
    );
    await searchVisualByImageUrl('https://example.com/a.jpg');
    await searchVisualByImageUrl('https://example.com/b.jpg');
    expect(fetchCalls).toBe(2);
  });

  it('a failed Lens call is not cached', async () => {
    setEnvKey('serpApiKey', 'test-serpapi-key');
    let fetchCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        fetchCalls++;
        return { ok: false, status: 500, json: async () => ({}) };
      })
    );
    expect(await searchVisualByImageUrl('https://example.com/fail.jpg')).toEqual([]);
    expect(await searchVisualByImageUrl('https://example.com/fail.jpg')).toEqual([]);
    // Phase 1 retry (§12 #6): a 500 is retried 3× per logical call,
    // so 2 logical calls = 6 fetches. The point is the SECOND call
    // still fetched (3 more attempts) instead of serving a cached
    // failure — a cached failure would have left the count at 3.
    expect(fetchCalls).toBe(6);
  });
});

describe('visual-search caption cache (§12 #11)', () => {
  it('second caption of the same image URL is a cache hit with no new fetch', async () => {
    setEnvKey('hfApiToken', 'test-hf-token');
    let fetchCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        fetchCalls++;
        // The image fetch (public IP URL) vs the HF caption call.
        if (String(url).startsWith('https://8.8.8.8/')) {
          return new Response(new Uint8Array([1, 2, 3, 4]), {
            status: 200,
            headers: { 'content-type': 'image/jpeg', 'content-length': '4' },
          });
        }
        return new Response(JSON.stringify([{ generated_text: 'a red laptop' }]), { status: 200 });
      })
    );

    const first = await captionPublicImageUrl('https://8.8.8.8/laptop.jpg');
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value).toBe('a red laptop');
      expect(first.cached).not.toBe(true);
    }
    expect(fetchCalls).toBe(2); // image fetch + HF caption call
    expect(getProviderBudgetState('huggingface').used).toBe(1);

    const second = await captionPublicImageUrl('https://8.8.8.8/laptop.jpg');
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value).toBe('a red laptop');
      expect(second.cached).toBe(true);
    }
    expect(fetchCalls).toBe(2);
    expect(getProviderBudgetState('huggingface').used).toBe(1);
    expect(getVisualSearchCacheSize()).toBe(1);
  });
});

describe('visual-search embedding cache (§12 #11)', () => {
  it('second embed of the same text is a cache hit with no new HF call (MiniLM)', async () => {
    setEnvKey('hfApiToken', 'test-hf-token');
    const vector = new Array(384).fill(0.01);
    let fetchCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        fetchCalls++;
        return new Response(JSON.stringify(vector), { status: 200 });
      })
    );

    const first = await embedText('phase8 cache probe laptop');
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value).toEqual(vector);
      expect(first.cached).not.toBe(true);
    }
    expect(fetchCalls).toBe(1);

    const second = await embedText('phase8 cache probe laptop');
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value).toEqual(vector);
      expect(second.cached).toBe(true);
    }
    expect(fetchCalls).toBe(1);
    expect(getProviderBudgetState('huggingface').used).toBe(1);

    // A different text is a miss and fetches again.
    const third = await embedText('phase8 cache probe phone');
    expect(third.ok).toBe(true);
    expect(fetchCalls).toBe(2);
  });

  it('CLIP and MiniLM embeddings never share a cache entry', async () => {
    setEnvKey('hfApiToken', 'test-hf-token');
    const minilm = new Array(384).fill(0.01);
    const clip = new Array(512).fill(0.02);
    let fetchCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        fetchCalls++;
        // CLIP model calls go to the openai/clip-vit-base-patch32 path.
        if (String(url).includes('clip-vit-base-patch32')) {
          return new Response(JSON.stringify(clip), { status: 200 });
        }
        return new Response(JSON.stringify(minilm), { status: 200 });
      })
    );

    const mini = await embedText('phase8 spaces probe');
    expect(mini.ok).toBe(true);
    if (mini.ok) expect(mini.value).toHaveLength(384);

    const clipRes = await embedTextClip('phase8 spaces probe');
    expect(clipRes.ok).toBe(true);
    if (clipRes.ok) expect(clipRes.value).toHaveLength(512);

    // Both repeat calls are cache hits (no further fetches), and
    // each still returns its own space's dimensions.
    expect(fetchCalls).toBe(2);
    const mini2 = await embedText('phase8 spaces probe');
    const clip2 = await embedTextClip('phase8 spaces probe');
    expect(fetchCalls).toBe(2);
    if (mini2.ok) expect(mini2.value).toHaveLength(384);
    if (clip2.ok) expect(clip2.value).toHaveLength(512);
  });
});
