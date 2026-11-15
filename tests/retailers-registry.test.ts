import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  getProviderRegistry,
  resetProviderRegistry,
} from '@/services/providers/registry';

// Retailers Delta — registry wiring for the eBay + Walmart adapters.
// No live keys: all credentials below are fake test values, and no
// test here touches the network.

const { privateKey: TEST_PRIVATE_KEY } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function setWalmartCreds(): void {
  process.env.WALMART_CONSUMER_ID = 'walmart-test-consumer-000';
  process.env.WALMART_PRIVATE_KEY = TEST_PRIVATE_KEY;
}

function setEbayCreds(): void {
  process.env.EBAY_CLIENT_ID = 'ebay-test-client-id';
  process.env.EBAY_CLIENT_SECRET = 'ebay-test-client-secret';
}

function setBestBuyKey(): void {
  process.env.BESTBUY_API_KEY = 'bb-test-key-000';
}

function clearCreds(): void {
  delete process.env.WALMART_CONSUMER_ID;
  delete process.env.WALMART_PRIVATE_KEY;
  delete process.env.WALMART_KEY_VERSION;
  delete process.env.EBAY_CLIENT_ID;
  delete process.env.EBAY_CLIENT_SECRET;
  delete process.env.BESTBUY_API_KEY;
}

describe('retailers registry — Walmart + eBay overrides', () => {
  beforeEach(() => {
    resetProviderRegistry();
    clearCreds();
  });

  afterEach(() => {
    resetProviderRegistry();
    clearCreds();
  });

  it('walmart resolves when its credentials are set', () => {
    setWalmartCreds();
    const registry = getProviderRegistry();
    const provider = registry.getForRetailer('walmart');
    expect(provider).toBeDefined();
    expect(provider?.key).toBe('walmart');
    expect(provider?.isAvailable()).toBe(true);
  });

  it('ebay resolves when its credentials are set (both slug spellings)', () => {
    setEbayCreds();
    const registry = getProviderRegistry();
    expect(registry.getForRetailer('ebay')?.key).toBe('ebay');
    expect(registry.getForRetailer('ebay.com')?.key).toBe('ebay');
  });

  it('an unavailable override returns undefined — never another merchant', () => {
    const registry = getProviderRegistry();
    expect(registry.get('walmart')).toBeDefined();
    expect(registry.get('walmart')?.isAvailable()).toBe(false);
    expect(registry.getForRetailer('walmart')).toBeUndefined();
    expect(registry.get('ebay')).toBeDefined();
    expect(registry.get('ebay')?.isAvailable()).toBe(false);
    expect(registry.getForRetailer('ebay')).toBeUndefined();
  });

  it('no cross-merchant fallback: Best Buy configured does not serve Walmart', () => {
    setBestBuyKey();
    const registry = getProviderRegistry();
    expect(registry.getForRetailer('bestbuy')?.key).toBe('bestbuy');
    expect(registry.getForRetailer('walmart')).toBeUndefined();
    expect(registry.getForRetailer('ebay')).toBeUndefined();
  });

  it('both new providers are registered in the provider list', () => {
    const registry = getProviderRegistry();
    const keys = registry.getAll().map((p) => p.key);
    expect(keys).toContain('walmart');
    expect(keys).toContain('ebay');
    expect(registry.get('walmart')?.category).toBe('official_api');
    expect(registry.get('ebay')?.category).toBe('official_api');
  });

  it('the documented daily budgets agree with the API terms (walmart 5,000 / ebay 4,500)', async () => {
    const { getProviderDailyBudgetLimit } = await import('@/services/provider-budget');
    expect(getProviderDailyBudgetLimit('walmart').limit).toBe(5_000);
    expect(getProviderDailyBudgetLimit('ebay').limit).toBe(4_500);
  });
});
