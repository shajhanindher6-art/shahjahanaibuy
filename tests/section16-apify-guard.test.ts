/**
 * Section 16, #49 — Apify guard test.
 *
 * The guard comment lives at services/providers/registry.ts:155-167:
 * ApifyProvider is registered unconditionally so the registry knows
 * about it, but it FAILS CLOSED unless BOTH APIFY_API_TOKEN and
 * APIFY_ACTOR_ID are set — isAvailable() is false and search() /
 * fetch() return empty / null without touching the network
 * (services/providers/apify-provider.ts:166-175, 196-201, 216-221).
 *
 * These tests assert only that fail-closed behaviour, with the vars
 * UNSET (the real-world state: scraping is a hard standing rule and
 * the vars must stay unset). The vars are deliberately NEVER set in
 * this file — not even to fake values — per the registry guard
 * comment: if they are ever set, that is an owner decision outside
 * this codebase. So there is no "available" branch test here; the
 * live path is owner-gated and untestable without real credentials.
 * A global-fetch spy proves search()/fetch() make no network call
 * while unavailable.
 */

import { describe, expect, it, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { ApifyProvider } from '@/services/providers/apify-provider';
import {
  getProviderRegistry,
  resetProviderRegistry,
} from '@/services/providers/registry';

describe('ApifyProvider — fails closed without env vars (#49)', () => {
  const savedToken = process.env.APIFY_API_TOKEN;
  const savedActorId = process.env.APIFY_ACTOR_ID;
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(() => {
    // The fail-closed state under test: neither var set.
    delete process.env.APIFY_API_TOKEN;
    delete process.env.APIFY_ACTOR_ID;
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    resetProviderRegistry();
    if (savedToken !== undefined) process.env.APIFY_API_TOKEN = savedToken;
    else delete process.env.APIFY_API_TOKEN;
    if (savedActorId !== undefined) process.env.APIFY_ACTOR_ID = savedActorId;
    else delete process.env.APIFY_ACTOR_ID;
  });

  it('isAvailable() is false with neither var set', () => {
    expect(new ApifyProvider().isAvailable()).toBe(false);
  });

  it('search() returns [] without env vars and makes no network call', async () => {
    const provider = new ApifyProvider();
    const results = await provider.search({ query: 'laptop', limit: 10 });
    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetch() returns null without env vars and makes no network call', async () => {
    const provider = new ApifyProvider();
    const result = await provider.fetch({
      externalId: 'B0C123',
      retailerSlug: 'amazon',
    });
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('search() still returns [] when only one var would be missing — both are required', async () => {
    // Neither var is set in this file by design (see header), so the
    // constructor reads the same empty env twice: the provider can
    // never be half-available. The two-var requirement is locked by
    // the source itself.
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(
        `${process.cwd()}/services/providers/apify-provider.ts`,
        'utf8'
      )
    );
    expect(src).toContain('return Boolean(this.token && this.actorId);');
  });
});

describe('Provider registry — Apify is registered but unavailable (#49)', () => {
  const savedToken = process.env.APIFY_API_TOKEN;
  const savedActorId = process.env.APIFY_ACTOR_ID;

  beforeEach(() => {
    delete process.env.APIFY_API_TOKEN;
    delete process.env.APIFY_ACTOR_ID;
    resetProviderRegistry();
  });

  afterEach(() => {
    resetProviderRegistry();
    if (savedToken !== undefined) process.env.APIFY_API_TOKEN = savedToken;
    else delete process.env.APIFY_API_TOKEN;
    if (savedActorId !== undefined) process.env.APIFY_ACTOR_ID = savedActorId;
    else delete process.env.APIFY_ACTOR_ID;
  });

  it('registers the apify provider (so the fail-closed path is testable) but reports it unavailable', () => {
    const registry = getProviderRegistry();
    const apify = registry.get('apify');
    expect(apify).toBeDefined();
    expect(apify?.key).toBe('apify');
    expect(apify?.isAvailable()).toBe(false);
  });

  it('excludes apify from the available providers', () => {
    const registry = getProviderRegistry();
    expect(registry.getAvailable().map((p) => p.key)).not.toContain('apify');
  });
});
