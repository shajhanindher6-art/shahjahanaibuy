import { describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import {
  ANONYMOUS_DAILY_QUOTA,
  API_QUOTAS,
  BILLING_URL,
  checkQuotaDecision,
  createMemoryQuotaStore,
  enforceApiQuota,
  getQuotaForTier,
  getUpgradeTier,
  quotaDayStart,
  quotaExceededResponse,
  resolveTierFromSubscription,
} from '@/lib/api-quota';
import type { ValidatedApiKey } from '@/lib/api-keys';

/** Minimal request stand-in: enforceApiQuota only reads headers. */
function fakeRequest(ip = '203.0.113.7'): Pick<NextRequest, 'headers'> {
  return { headers: new Headers({ 'x-real-ip': ip }) } as Pick<NextRequest, 'headers'>;
}

function fakeKey(keyPrefix = 'sbk_live_abcdefgh'): ValidatedApiKey {
  return { userId: 'user-1', keyPrefix, scopes: ['products:read'] };
}

describe('getQuotaForTier', () => {
  it('tiers differ: Premium > Free and Team is highest', () => {
    expect(getQuotaForTier('premium')).toBeGreaterThan(getQuotaForTier('free'));
    expect(getQuotaForTier('team')).toBeGreaterThan(getQuotaForTier('premium'));
    expect(getQuotaForTier('free')).toBe(1_000);
    expect(getQuotaForTier('premium')).toBe(10_000);
    expect(getQuotaForTier('team')).toBe(100_000);
  });

  it('Family matches Premium (Premium for up to 5 members)', () => {
    expect(getQuotaForTier('family')).toBe(getQuotaForTier('premium'));
  });

  it('every quota in API_QUOTAS is a positive number', () => {
    for (const quota of Object.values(API_QUOTAS)) {
      expect(quota).toBeGreaterThan(0);
    }
  });
});

describe('getUpgradeTier', () => {
  it('Free upgrades to Premium, Premium/Family to Team, Team to nothing', () => {
    expect(getUpgradeTier('free')).toBe('premium');
    expect(getUpgradeTier('premium')).toBe('team');
    expect(getUpgradeTier('family')).toBe('team');
    expect(getUpgradeTier('team')).toBeNull();
  });
});

describe('resolveTierFromSubscription', () => {
  it('maps active paid plans onto tiers', () => {
    expect(resolveTierFromSubscription('premium', 'active')).toBe('premium');
    expect(resolveTierFromSubscription('pro', 'active')).toBe('premium');
    expect(resolveTierFromSubscription('family', 'active')).toBe('family');
    expect(resolveTierFromSubscription('team', 'active')).toBe('team');
  });

  it('falls back to free for non-active, unknown, or missing plans', () => {
    expect(resolveTierFromSubscription('premium', 'canceled')).toBe('free');
    expect(resolveTierFromSubscription('premium', 'trialing')).toBe('free');
    expect(resolveTierFromSubscription('enterprise', 'active')).toBe('free');
    expect(resolveTierFromSubscription('free', 'active')).toBe('free');
    expect(resolveTierFromSubscription(null, null)).toBe('free');
  });
});

describe('checkQuotaDecision', () => {
  it('allows use at the limit and reports remaining', () => {
    const resetAt = new Date('2026-11-11T00:00:00.000Z');
    const atLimit = checkQuotaDecision(1_000, 1_000, 'free', resetAt);
    expect(atLimit.allowed).toBe(true);
    expect(atLimit.remaining).toBe(0);

    const over = checkQuotaDecision(1_001, 1_000, 'free', resetAt);
    expect(over.allowed).toBe(false);
    expect(over.remaining).toBe(0);
    expect(over.used).toBe(1_001);
  });
});

describe('quotaDayStart', () => {
  it('returns UTC midnight of the same day', () => {
    expect(quotaDayStart(new Date('2026-11-10T20:56:26+05:00')).toISOString()).toBe(
      '2026-11-10T00:00:00.000Z'
    );
  });
});

describe('createMemoryQuotaStore', () => {
  it('counts per bucket and enforces the limit', () => {
    const store = createMemoryQuotaStore();
    const now = new Date('2026-11-10T10:00:00.000Z');
    let last = store.checkAndIncrement('key:sbk_live_abcdefgh', 3, 'free', now);
    last = store.checkAndIncrement('key:sbk_live_abcdefgh', 3, 'free', now);
    last = store.checkAndIncrement('key:sbk_live_abcdefgh', 3, 'free', now);
    expect(last.allowed).toBe(true);
    expect(last.used).toBe(3);
    expect(last.remaining).toBe(0);
    last = store.checkAndIncrement('key:sbk_live_abcdefgh', 3, 'free', now);
    expect(last.allowed).toBe(false);
    expect(last.used).toBe(4);
  });

  it('keeps buckets independent per key', () => {
    const store = createMemoryQuotaStore();
    const now = new Date('2026-11-10T10:00:00.000Z');
    store.checkAndIncrement('key:aaaa', 1, 'free', now);
    const other = store.checkAndIncrement('key:bbbb', 1, 'free', now);
    expect(other.allowed).toBe(true);
    expect(other.used).toBe(1);
    expect(store.checkAndIncrement('key:aaaa', 1, 'free', now).allowed).toBe(false);
  });

  it('resets when the UTC day rolls over', () => {
    const store = createMemoryQuotaStore();
    const dayOne = new Date('2026-11-10T23:59:00.000Z');
    const dayTwo = new Date('2026-11-11T00:01:00.000Z');
    store.checkAndIncrement('key:aaaa', 1, 'free', dayOne);
    expect(store.checkAndIncrement('key:aaaa', 1, 'free', dayOne).allowed).toBe(false);
    const next = store.checkAndIncrement('key:aaaa', 1, 'free', dayTwo);
    expect(next.allowed).toBe(true);
    expect(next.used).toBe(1);
    expect(next.resetAt.toISOString()).toBe('2026-11-12T00:00:00.000Z');
  });
});

describe('quotaExceededResponse', () => {
  it('returns 429 with the tier, upgrade, and existing pricing link', async () => {
    const decision = checkQuotaDecision(
      1_001,
      1_000,
      'free',
      new Date('2026-11-11T00:00:00.000Z')
    );
    const res = quotaExceededResponse(decision);
    expect(res.status).toBe(429);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string; details: Record<string, unknown> };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.message).toContain('Free');
    expect(body.error.message).toContain('Premium');
    expect(body.error.message).toContain('1,000');
    expect(body.error.details.billingUrl).toBe(BILLING_URL);
    expect(body.error.details.billingUrl).toBe('/#pricing');
    expect(body.error.details.upgradeTier).toBe('premium');
    expect(body.error.details.limit).toBe(1_000);
  });

  it('anonymous variant points at a free key instead of a paid tier', async () => {
    const decision = checkQuotaDecision(
      ANONYMOUS_DAILY_QUOTA + 1,
      ANONYMOUS_DAILY_QUOTA,
      'free',
      new Date('2026-11-11T00:00:00.000Z')
    );
    const res = quotaExceededResponse(decision, { anonymous: true });
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain('Anonymous');
    expect(body.error.message).toContain('free API key');
  });

  it('top tier has no upgrade tier to offer', async () => {
    const decision = checkQuotaDecision(
      100_001,
      100_000,
      'team',
      new Date('2026-11-11T00:00:00.000Z')
    );
    const body = (await (await quotaExceededResponse(decision)).json()) as {
      error: { message: string; details: Record<string, unknown> };
    };
    expect(body.error.details.upgradeTier).toBeNull();
    expect(body.error.message).toContain('highest quota tier');
  });
});

describe('enforceApiQuota', () => {
  it('free key-optional access still works: anonymous request is allowed', async () => {
    const store = createMemoryQuotaStore();
    const result = await enforceApiQuota(fakeRequest(), { store });
    expect(result).toBeNull();
  });

  it('counts per key and returns 429 once the free quota is exceeded', async () => {
    const store = createMemoryQuotaStore();
    const key = fakeKey();
    const resolveTier = async () => 'free' as const;
    let result: Awaited<ReturnType<typeof enforceApiQuota>> = null;
    for (let i = 0; i < API_QUOTAS.free; i++) {
      result = await enforceApiQuota(fakeRequest(), { store, keyInfo: key, resolveTier });
      expect(result).toBeNull();
    }
    result = await enforceApiQuota(fakeRequest(), { store, keyInfo: key, resolveTier });
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);
    const body = (await result!.json()) as { error: { message: string } };
    expect(body.error.message).toContain('Free');
    expect(body.error.message).toContain('Premium');
  });

  it('tier quotas differ: the same usage that exhausts Free still passes on Premium', async () => {
    const store = createMemoryQuotaStore();
    const key = fakeKey();
    const freeTier = async () => 'free' as const;
    const premiumTier = async () => 'premium' as const;
    // Burn the entire free quota on one key prefix.
    for (let i = 0; i < API_QUOTAS.free; i++) {
      await enforceApiQuota(fakeRequest(), { store, keyInfo: key, resolveTier: freeTier });
    }
    expect(
      await enforceApiQuota(fakeRequest(), { store, keyInfo: key, resolveTier: freeTier })
    ).not.toBeNull();
    // Same bucket, premium tier: still allowed (premium limit is 10x).
    const premiumStore = createMemoryQuotaStore();
    for (let i = 0; i < API_QUOTAS.free; i++) {
      expect(
        await enforceApiQuota(fakeRequest(), { store: premiumStore, keyInfo: key, resolveTier: premiumTier })
      ).toBeNull();
    }
    expect(
      await enforceApiQuota(fakeRequest(), { store: premiumStore, keyInfo: key, resolveTier: premiumTier })
    ).toBeNull();
  });

  it('unauthenticated high-volume requests are gated at the anonymous cap', async () => {
    const store = createMemoryQuotaStore();
    let result: Awaited<ReturnType<typeof enforceApiQuota>> = null;
    for (let i = 0; i < ANONYMOUS_DAILY_QUOTA; i++) {
      result = await enforceApiQuota(fakeRequest(), { store });
      expect(result).toBeNull();
    }
    result = await enforceApiQuota(fakeRequest(), { store });
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);
    const body = (await result!.json()) as {
      error: { message: string; details: Record<string, unknown> };
    };
    expect(body.error.message).toContain('Anonymous');
    expect(body.error.details.billingUrl).toBe('/#pricing');
  });

  it('different IPs get separate anonymous buckets', async () => {
    const store = createMemoryQuotaStore();
    for (let i = 0; i < ANONYMOUS_DAILY_QUOTA; i++) {
      await enforceApiQuota(fakeRequest('203.0.113.7'), { store });
    }
    expect(await enforceApiQuota(fakeRequest('203.0.113.7'), { store })).not.toBeNull();
    expect(await enforceApiQuota(fakeRequest('198.51.100.9'), { store })).toBeNull();
  });

  it('keys without a paid tier stay on the free quota', async () => {
    const store = createMemoryQuotaStore();
    const key = fakeKey();
    // Default resolver would hit the DB; inject the fail-safe free tier.
    const resolveTier = async () => resolveTierFromSubscription(null, null);
    let result: Awaited<ReturnType<typeof enforceApiQuota>> = null;
    for (let i = 0; i < API_QUOTAS.free; i++) {
      result = await enforceApiQuota(fakeRequest(), { store, keyInfo: key, resolveTier });
    }
    expect(result).toBeNull();
    result = await enforceApiQuota(fakeRequest(), { store, keyInfo: key, resolveTier });
    expect(result!.status).toBe(429);
  });
});
