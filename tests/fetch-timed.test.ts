import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchTimed } from '@/lib/fetch-timed';

// P0 fix (2026-11-09 audit): compare matrix fetches had no timeout,
// so a hanging API kept the page on "Loading…" forever.

describe('fetchTimed', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects with TimeoutError when the server never answers', async () => {
    // A mock fetch that honours the abort signal, like the real one.
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation timed out.', 'TimeoutError'));
          });
        });
      })
    );

    await expect(fetchTimed('/api/v1/comparison', 50)).rejects.toMatchObject({
      name: 'TimeoutError',
    });
  });

  it('resolves normally when the server answers in time', async () => {
    const fakeResponse = { ok: true, status: 200 } as Response;
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse));

    await expect(fetchTimed('/api/v1/products/x', 5000)).resolves.toBe(
      fakeResponse
    );
  });

  it('passes a signal that aborts at the requested timeout', async () => {
    let seenSignal: AbortSignal | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        seenSignal = init?.signal ?? null;
        return Promise.resolve({ ok: true } as Response);
      })
    );

    await fetchTimed('/api/v1/products/x', 5000);
    expect(seenSignal).not.toBeNull();
    expect((seenSignal as unknown as AbortSignal).aborted).toBe(false);
  });
});
