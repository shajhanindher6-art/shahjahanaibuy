/**
 * Section 16, #49 — Apify guard test.
 *
 * The guard comment lives at services/providers/registry.ts:155-167:
 * ApifyProvider is registered unconditionally so the registry knows
 * about it, but it FAILS CLOSED unless BOTH APIFY_API_TOKEN and
 * APIFY_ACTOR_ID are set — isAvailable() is false and search() /
 * fetch() THROW a typed ProviderNotConfiguredError naming the ban,
 * without touching the network (Sections 21–25, Stage B, B1: the
 * old silent [] / null let callers read "no results" as if Apify
 * had been checked — a banned source must never look checked).
 *
 * These tests assert only that fail-closed behaviour, with the vars
 * UNSET (the real-world state: scraping is a hard standing rule and
 * the vars must stay unset) — plus, since the Final 100% kill-switch
 * (F-P1-59), the same assertions WITH the vars set to fake values:
 * setting them must change nothing, because isAvailable() now
 * hard-fails in code and the constructor never reads the env. The
 * fake values here are never real credentials and never leave the
 * test process. A global-fetch spy proves search()/fetch() make no
 * network call while unavailable.
 */

import { describe, expect, it, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { ApifyProvider } from '@/services/providers/apify-provider';
import { ProviderNotConfiguredError } from '@/services/providers/errors';
import {
  getProviderRegistry,
  resetProviderRegistry,
} from '@/services/providers/registry';

function readApifySource(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs');
  return fs.readFileSync(
    `${process.cwd()}/services/providers/apify-provider.ts`,
    'utf8'
  );
}

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

  it('isAvailable() stays false EVEN WHEN both vars are set (kill-switch, Final 100% F-P1-59)', () => {
    process.env.APIFY_API_TOKEN = 'apify-token-set-in-dashboard';
    process.env.APIFY_ACTOR_ID = 'some-actor-id';
    expect(new ApifyProvider().isAvailable()).toBe(false);
  });

  it('search() still throws NOT_CONFIGURED with both vars set and makes no network call', async () => {
    process.env.APIFY_API_TOKEN = 'apify-token-set-in-dashboard';
    process.env.APIFY_ACTOR_ID = 'some-actor-id';
    const provider = new ApifyProvider();
    await expect(provider.search({ query: 'laptop', limit: 10 })).rejects.toThrow(
      ProviderNotConfiguredError
    );
    await expect(provider.search({ query: 'laptop', limit: 10 })).rejects.toThrow(
      /scraping is banned/
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('search() throws NOT_CONFIGURED without env vars and makes no network call', async () => {
    const provider = new ApifyProvider();
    await expect(provider.search({ query: 'laptop', limit: 10 })).rejects.toThrow(
      ProviderNotConfiguredError
    );
    await expect(provider.search({ query: 'laptop', limit: 10 })).rejects.toThrow(
      /scraping is banned/
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetch() throws NOT_CONFIGURED without env vars and makes no network call', async () => {
    const provider = new ApifyProvider();
    await expect(
      provider.fetch({
        externalId: 'B0C123',
        retailerSlug: 'amazon',
      })
    ).rejects.toThrow(ProviderNotConfiguredError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('the kill-switch is in the source: isAvailable() hard-fails (Final 100% F-P1-59)', () => {
    // The old two-var requirement ('return Boolean(this.token &&
    // this.actorId);') is gone by design: a Vercel env edit used
    // to be able to activate scraping. The source must now contain
    // the unconditional hard-fail and must NOT read the env vars.
    const src = readApifySource();
    expect(src).toContain('return false;');
    expect(src).not.toContain('process.env.APIFY_API_TOKEN');
    expect(src).not.toContain('process.env.APIFY_ACTOR_ID');
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
