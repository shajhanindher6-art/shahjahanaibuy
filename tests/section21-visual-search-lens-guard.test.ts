/**
 * Sections 21–25, Stage K (K2) — Lens SSRF guard, helper + route.
 *
 * The /scan route guards the Lens leg (S20 #95), but the helper
 * `searchVisualByImageUrlWithMeta` used to hand a user URL straight
 * to SerpAPI with no check of its own — any future caller (the AI
 * engine provider calls it via `searchVisualByImageUrl`) bypassed
 * the route guard. The helper now runs the same SSRF guard itself
 * (defense in depth), and these tests pin BOTH layers:
 *
 * Helper level (real `searchVisualByImageUrlWithMeta`, stubbed
 * fetch, key configured via the env mock):
 *   metadata / localhost / non-http URLs → [] and fetch NEVER
 *   called (the guard fires before the network, and before the
 *   cache lookup — a cached private-URL entry is never served);
 *   a normal public URL still reaches SerpAPI.
 *
 * Route level (real POST /api/v1/scan, mocked engine + ai-search):
 *   a blocked image URL + keywords → keyword-assisted fallback
 *   with the honest note, and the Lens engine is never invoked;
 *   a blocked image URL with NO keywords → 400, never a guessed
 *   result; a public image URL reaches the engine and returns
 *   mode 'visual'.
 *
 * Literal public IPs are used for the "passes" cases so the tests
 * never depend on live DNS; localhost resolves via the OS resolver.
 * The SerpAPI daily budget is reset per test (5/day/instance) and
 * the Lens cache cleared, so tests never starve each other.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  clearVisualSearchCache,
  searchVisualByImageUrlWithMeta,
} from '@/services/visual-search';
import { resetAiUsage } from '@/services/ai-engine/usage';

const invokeSpy = vi.hoisted(() => vi.fn());

vi.mock('@/lib/config/env', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/config/env')>();
  return {
    ...actual,
    env: { ...actual.env, serpApiKey: 'test-serpapi-key' },
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({}),
}));

vi.mock('@/services/ai-search', () => ({
  getCachedAISearch: async () => ({ results: [] }),
}));

vi.mock('@/services/ai-engine', () => ({
  getAiEngine: () => ({ invoke: invokeSpy }),
}));

// Imported after the mocks so the route under test uses the fakes.
import { POST as scanPost } from '@/app/api/v1/scan/route';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearVisualSearchCache();
});

beforeEach(() => {
  resetAiUsage();
  invokeSpy.mockReset();
  invokeSpy.mockResolvedValue({ value: [], fromCache: false });
});

function lensFetch(matches: Array<Record<string, unknown>>) {
  return vi.fn(async () =>
    Response.json({ visual_matches: matches })
  );
}

describe('searchVisualByImageUrlWithMeta — SSRF guard in the helper (K2)', () => {
  it('rejects the cloud metadata address before any fetch happens', async () => {
    const fetchSpy = lensFetch([]);
    vi.stubGlobal('fetch', fetchSpy);
    const result = await searchVisualByImageUrlWithMeta(
      'http://169.254.169.254/latest/meta-data/'
    );
    expect(result).toEqual({ matches: [], fromCache: false, fetchedAt: null });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects localhost and private-network URLs before any fetch happens', async () => {
    const fetchSpy = lensFetch([]);
    vi.stubGlobal('fetch', fetchSpy);
    for (const url of [
      'http://localhost/image.jpg',
      'http://127.0.0.1/image.jpg',
      'http://10.0.0.5/image.jpg',
      'http://192.168.1.1/image.jpg',
      'http://[::1]/image.jpg',
    ]) {
      const result = await searchVisualByImageUrlWithMeta(url);
      expect(result.matches, url).toEqual([]);
      expect(result.fetchedAt, url).toBeNull();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects non-http(s) URLs before any fetch happens', async () => {
    const fetchSpy = lensFetch([]);
    vi.stubGlobal('fetch', fetchSpy);
    const result = await searchVisualByImageUrlWithMeta('file:///etc/passwd');
    expect(result.matches).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('still fetches a normal public URL (literal public IP, no DNS needed)', async () => {
    const fetchSpy = lensFetch([
      { title: 'MacBook Air 13', source: 'example.com', link: 'https://example.com/mba', thumbnail: null },
    ]);
    vi.stubGlobal('fetch', fetchSpy);
    const result = await searchVisualByImageUrlWithMeta('https://8.8.8.8/image.jpg');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String((fetchSpy.mock.calls[0] as unknown as unknown[])?.[0] ?? '')).toContain('serpapi.com/search.json');
    expect(String((fetchSpy.mock.calls[0] as unknown as unknown[])?.[0] ?? '')).toContain('engine=google_lens');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].title).toBe('MacBook Air 13');
    expect(result.fromCache).toBe(false);
    expect(result.fetchedAt).not.toBeNull();
  });

  it('does not serve a cached entry for a URL the guard now rejects', async () => {
    // Prime the cache with a public URL, then prove a private URL
    // never hits the cache path: the guard runs BEFORE the lookup.
    const fetchSpy = lensFetch([{ title: 'Cached', source: null, link: null, thumbnail: null }]);
    vi.stubGlobal('fetch', fetchSpy);
    const first = await searchVisualByImageUrlWithMeta('https://8.8.8.8/image.jpg');
    expect(first.matches).toHaveLength(1);
    const blocked = await searchVisualByImageUrlWithMeta('http://169.254.169.254/latest/meta-data/');
    expect(blocked).toEqual({ matches: [], fromCache: false, fetchedAt: null });
    // Only the public-URL call fetched; the blocked call added no
    // second fetch and returned nothing from cache.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/v1/scan — Lens route guard pinned (K2)', () => {
  function scanRequest(body: Record<string, unknown>, ip: string) {
    return new NextRequest('http://localhost/api/v1/scan', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': ip,
      },
      body: JSON.stringify(body),
    });
  }

  it('blocked image URL + keywords → keyword-assisted fallback, Lens never invoked', async () => {
    const res = await scanPost(
      scanRequest(
        { imageUrl: 'http://169.254.169.254/latest/meta-data/', keywords: 'macbook air' },
        '203.0.113.1'
      )
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: unknown[];
      meta?: { mode?: string; note?: string };
    };
    expect(body.success).toBe(true);
    expect(body.meta?.mode).toBe('keyword-assisted');
    expect(body.meta?.note ?? '').toContain('could not be verified as a public URL');
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it('blocked image URL with no keywords → 400, never a guessed result', async () => {
    const res = await scanPost(
      scanRequest({ imageUrl: 'http://localhost/image.jpg' }, '203.0.113.2')
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error?: { message?: string } };
    expect(body.success).toBe(false);
    expect(body.error?.message ?? '').toContain('Only public image URLs');
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it('public image URL reaches the engine and returns visual mode', async () => {
    invokeSpy.mockResolvedValue({
      value: [{ title: 'MacBook Air 13', source: 'example.com', link: 'https://example.com/mba', thumbnail: null }],
      fromCache: false,
    });
    const res = await scanPost(
      scanRequest({ imageUrl: 'https://8.8.8.8/image.jpg' }, '203.0.113.3')
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: Array<{ title: string }>;
      meta?: { mode?: string };
    };
    expect(body.success).toBe(true);
    expect(body.meta?.mode).toBe('visual');
    expect(body.data).toHaveLength(1);
    expect(body.data[0].title).toBe('MacBook Air 13');
    expect(invokeSpy).toHaveBeenCalledTimes(1);
    expect(invokeSpy.mock.calls[0][1]).toMatchObject({ imageUrl: 'https://8.8.8.8/image.jpg' });
  });
});
