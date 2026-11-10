/**
 * Stripe live-mode guard (S2#11).
 *
 * Rule: a bare `sk_live_` key must NEVER enable real charges. Live
 * mode only counts as launched when the owner explicitly sets
 * `STRIPE_LIVE_LAUNCHED=true` in the hosting dashboard. Test mode
 * is never blocked.
 *
 * lib/stripe.ts reads the key from lib/config/env at import time,
 * so each case re-imports the module with a fresh env (vi.resetModules
 * + dynamic import). No real key is used anywhere — only prefixes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type StripeGuard = typeof import('@/lib/stripe');

async function loadStripe(): Promise<StripeGuard> {
  vi.resetModules();
  return (await import('@/lib/stripe')) as StripeGuard;
}

describe('isStripeLiveMode / isStripeLiveModeBlocked', () => {
  const savedKey = process.env.STRIPE_SECRET_KEY;
  const savedFlag = process.env.STRIPE_LIVE_LAUNCHED;

  beforeEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_LIVE_LAUNCHED;
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = savedKey;
    if (savedFlag === undefined) delete process.env.STRIPE_LIVE_LAUNCHED;
    else process.env.STRIPE_LIVE_LAUNCHED = savedFlag;
    vi.resetModules();
  });

  it('no key configured: not live, not blocked', async () => {
    const s = await loadStripe();
    expect(s.isStripeConfigured()).toBe(false);
    expect(s.isStripeLiveMode()).toBe(false);
    expect(s.isStripeLiveModeBlocked()).toBe(false);
  });

  it('test key: live mode off, never blocked', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_FAKE';
    const s = await loadStripe();
    expect(s.isStripeConfigured()).toBe(true);
    expect(s.isStripeLiveMode()).toBe(false);
    expect(s.isStripeLiveModeBlocked()).toBe(false);
  });

  it('live key WITHOUT launch approval: live, BLOCKED', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_FAKE';
    const s = await loadStripe();
    expect(s.isStripeLiveMode()).toBe(true);
    expect(s.isStripeLiveLaunchApproved()).toBe(false);
    expect(s.isStripeLiveModeBlocked()).toBe(true);
  });

  it('live key WITH STRIPE_LIVE_LAUNCHED=true: live, not blocked', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_FAKE';
    process.env.STRIPE_LIVE_LAUNCHED = 'true';
    const s = await loadStripe();
    expect(s.isStripeLiveMode()).toBe(true);
    expect(s.isStripeLiveLaunchApproved()).toBe(true);
    expect(s.isStripeLiveModeBlocked()).toBe(false);
  });

  it('launch flag must be exactly "true" (no "1", "yes", or "TRUE")', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_FAKE';
    for (const flag of ['1', 'yes', 'TRUE', ' true']) {
      process.env.STRIPE_LIVE_LAUNCHED = flag;
      const s = await loadStripe();
      expect(s.isStripeLiveLaunchApproved()).toBe(false);
      expect(s.isStripeLiveModeBlocked()).toBe(true);
    }
  });

  it('test key + launch flag: still not live, still not blocked', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_FAKE';
    process.env.STRIPE_LIVE_LAUNCHED = 'true';
    const s = await loadStripe();
    expect(s.isStripeLiveMode()).toBe(false);
    expect(s.isStripeLiveModeBlocked()).toBe(false);
  });
});
