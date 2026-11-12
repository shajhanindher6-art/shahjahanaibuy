/**
 * Section 16, #40 — SW offline precache of recently-viewed product
 * pages (CACHE_URLS message handler, public/sw.js).
 *
 * Behavioural, not source-text: public/sw.js is executed in a fake
 * service-worker global (node:vm) with an in-memory CacheStorage,
 * and the CACHE_URLS message handler is driven the way the app
 * drives it (lib/recently-viewed.ts posts { type: 'CACHE_URLS',
 * urls: [...] } to the controlling worker). The handler's own
 * contract, read from the worker:
 * - caches same-origin /products/[slug] URLs into the runtime
 *   cache (RUNTIME_CACHE, smartbuy-v4-runtime);
 * - max 20 URLs per message;
 * - same-origin only, /products/ path only, failures swallowed
 *   per URL;
 * - non-CACHE_URLS messages and a non-array urls payload are
 *   ignored.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

const root = (...parts: string[]) => join(process.cwd(), ...parts);
const SW_SOURCE = readFileSync(root('public/sw.js'), 'utf8');

const ORIGIN = 'https://smartbuy.test';
const RUNTIME_CACHE = 'smartbuy-v4-runtime';

interface FakeCache {
  entries: Map<string, string>;
  add(url: string): Promise<void>;
  match(url: string): Promise<string | undefined>;
  put(url: string, response: string): Promise<void>;
  keys(): Promise<string[]>;
  delete(url: string): Promise<boolean>;
}

function createFakeCache(): FakeCache {
  const entries = new Map<string, string>();
  return {
    entries,
    async add(url: string) {
      entries.set(url, `cached:${url}`);
    },
    async match(url: string) {
      return entries.get(url);
    },
    async put(url: string, response: string) {
      entries.set(url, response);
    },
    async keys() {
      return [...entries.keys()];
    },
    async delete(url: string) {
      return entries.delete(url);
    },
  };
}

type EventHandler = (event: Record<string, unknown>) => void;

/**
 * Execute public/sw.js in a fake worker global and return the
 * registered handlers plus the fake caches, so a test can dispatch
 * a message event and inspect what got cached.
 */
function loadWorker() {
  const handlers = new Map<string, EventHandler>();
  const cachesByName = new Map<string, FakeCache>();
  let skipWaitingCalled = false;

  const fakeCaches = {
    async open(name: string): Promise<FakeCache> {
      let cache = cachesByName.get(name);
      if (!cache) {
        cache = createFakeCache();
        cachesByName.set(name, cache);
      }
      return cache;
    },
    async match(url: string): Promise<string | undefined> {
      for (const cache of cachesByName.values()) {
        const hit = await cache.match(url);
        if (hit) return hit;
      }
      return undefined;
    },
    async keys(): Promise<string[]> {
      return [...cachesByName.keys()];
    },
    async delete(name: string): Promise<boolean> {
      return cachesByName.delete(name);
    },
  };

  const sandbox: Record<string, unknown> = {
    console,
    URL,
    caches: fakeCaches,
    fetch: async () => {
      throw new Error('no network in the CACHE_URLS tests');
    },
    clients: {
      matchAll: async () => [],
      openWindow: async () => null,
    },
    self: {
      location: { origin: ORIGIN },
      registration: { showNotification: async () => {} },
      skipWaiting: () => {
        skipWaitingCalled = true;
      },
      addEventListener: (type: string, handler: EventHandler) => {
        handlers.set(type, handler);
      },
    },
  };
  // The worker refers to the bare `self` global.
  runInNewContext(SW_SOURCE, sandbox);

  const messageHandler = handlers.get('message');
  if (!messageHandler) throw new Error('sw.js registered no message handler');

  return {
    handlers,
    cachesByName,
    wasSkipWaitingCalled: () => skipWaitingCalled,
    /**
     * Dispatch a message event exactly as the browser does and await
     * the promise the handler passes to event.waitUntil (if any).
     */
    async postMessage(data: unknown): Promise<void> {
      const pending: Promise<unknown>[] = [];
      messageHandler({
        data,
        waitUntil: (p: Promise<unknown>) => {
          pending.push(p);
        },
      });
      await Promise.all(pending);
    },
    runtimeCache(): FakeCache | undefined {
      return cachesByName.get(RUNTIME_CACHE);
    },
  };
}

describe('SW CACHE_URLS — caches the posted product pages (#40)', () => {
  let worker: ReturnType<typeof loadWorker>;

  beforeEach(() => {
    worker = loadWorker();
  });

  it('caches same-origin /products/[slug] URLs (relative and absolute) into the runtime cache', async () => {
    await worker.postMessage({
      type: 'CACHE_URLS',
      urls: [
        '/products/macbook-air-13',
        'https://smartbuy.test/products/galaxy-s24-ultra',
        '/products/sony-wh-1000xm5?ref=recent',
      ],
    });
    const cache = worker.runtimeCache();
    expect(cache).toBeDefined();
    expect([...(cache as FakeCache).entries.keys()].sort()).toEqual([
      '/products/galaxy-s24-ultra',
      '/products/macbook-air-13',
      '/products/sony-wh-1000xm5?ref=recent',
    ]);
  });

  it('caps at 20 URLs per message — the first 20 win', async () => {
    const urls = Array.from({ length: 25 }, (_, i) => `/products/item-${i}`);
    await worker.postMessage({ type: 'CACHE_URLS', urls });
    const cache = worker.runtimeCache();
    expect(cache).toBeDefined();
    expect((cache as FakeCache).entries.size).toBe(20);
    expect((cache as FakeCache).entries.has('/products/item-19')).toBe(true);
    expect((cache as FakeCache).entries.has('/products/item-20')).toBe(false);
    expect((cache as FakeCache).entries.has('/products/item-24')).toBe(false);
  });

  it('ignores cross-origin URLs', async () => {
    await worker.postMessage({
      type: 'CACHE_URLS',
      urls: [
        '/products/macbook-air-13',
        'https://www.amazon.com/dp/B0C123',
        'https://evil.test/products/macbook-air-13',
      ],
    });
    const cache = worker.runtimeCache();
    expect(cache).toBeDefined();
    expect([...(cache as FakeCache).entries.keys()]).toEqual(['/products/macbook-air-13']);
  });

  it('ignores same-origin URLs outside /products/', async () => {
    await worker.postMessage({
      type: 'CACHE_URLS',
      urls: ['/', '/deals', '/tools', '/products', '/productsx/macbook-air-13'],
    });
    // '/products' itself has no slug segment, '/productsx/...' is a
    // different path — neither is a product page, so nothing caches.
    const cache = worker.runtimeCache();
    expect(cache).toBeDefined();
    expect((cache as FakeCache).entries.size).toBe(0);
  });

  it('ignores non-CACHE_URLS messages and a non-array urls payload, without throwing', async () => {
    await worker.postMessage({ type: 'SKIP_WAITING' });
    expect(worker.wasSkipWaitingCalled()).toBe(true);
    await worker.postMessage({ type: 'OTHER', urls: ['/products/macbook-air-13'] });
    await worker.postMessage({ type: 'CACHE_URLS', urls: 'not-an-array' });
    await worker.postMessage({ type: 'CACHE_URLS' });
    await worker.postMessage(null);
    const cache = worker.runtimeCache();
    // SKIP_WAITING opened no cache; the ignored messages cached
    // nothing either (the runtime cache may not even exist).
    expect(cache === undefined || cache.entries.size === 0).toBe(true);
  });

  it('swallows an unparseable URL instead of failing the whole message', async () => {
    await worker.postMessage({
      type: 'CACHE_URLS',
      urls: ['/products/macbook-air-13', 'http://[invalid', '/products/galaxy-s24-ultra'],
    });
    const cache = worker.runtimeCache();
    expect(cache).toBeDefined();
    expect([...(cache as FakeCache).entries.keys()].sort()).toEqual([
      '/products/galaxy-s24-ultra',
      '/products/macbook-air-13',
    ]);
  });

  it('accumulates across messages (recently-viewed posts one slug at a time)', async () => {
    await worker.postMessage({ type: 'CACHE_URLS', urls: ['/products/macbook-air-13'] });
    await worker.postMessage({ type: 'CACHE_URLS', urls: ['/products/galaxy-s24-ultra'] });
    const cache = worker.runtimeCache();
    expect(cache).toBeDefined();
    expect([...(cache as FakeCache).entries.keys()].sort()).toEqual([
      '/products/galaxy-s24-ultra',
      '/products/macbook-air-13',
    ]);
  });
});

describe('SW precache wiring — /products stays precached, app posts CACHE_URLS (#40)', () => {
  it('/products is in STATIC_ASSETS (install precache)', () => {
    const sw = readFileSync(root('public/sw.js'), 'utf8');
    expect(sw).toContain("'/products',");
  });

  it('lib/recently-viewed.ts posts { type: CACHE_URLS } with the viewed slug', () => {
    const src = readFileSync(root('lib/recently-viewed.ts'), 'utf8');
    expect(src).toContain("type: 'CACHE_URLS'");
    expect(src).toContain('`/products/${slug}`');
  });
});
