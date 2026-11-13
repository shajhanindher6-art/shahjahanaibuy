import { describe, expect, it, afterEach } from 'vitest';
import { describePlatformStatus } from '@/services/platform-status';

// Section 8 — platform status is honest by construction: a
// platform with no configured account is never reported as
// connected, and no secret value ever appears in the output.

const AMAZON_TAG = 'AMAZON_ASSOC_TAG';
const EBAY_ID = 'EBAY_CLIENT_ID';
const EBAY_SECRET = 'EBAY_CLIENT_SECRET';
const SKIMLINKS = 'SKIMLINKS_PUBLISHER_ID';

const saved: Record<string, string | undefined> = {
  [AMAZON_TAG]: process.env[AMAZON_TAG],
  [EBAY_ID]: process.env[EBAY_ID],
  [EBAY_SECRET]: process.env[EBAY_SECRET],
  [SKIMLINKS]: process.env[SKIMLINKS],
};

function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearAll() {
  setEnv({
    [AMAZON_TAG]: undefined,
    [EBAY_ID]: undefined,
    [EBAY_SECRET]: undefined,
    [SKIMLINKS]: undefined,
  });
}

afterEach(() => setEnv(saved));

function byId(id: string) {
  const entry = describePlatformStatus().find((p) => p.id === id);
  if (!entry) throw new Error(`missing platform ${id}`);
  return entry;
}

describe('describePlatformStatus', () => {
  it('reports every platform, with unique ids, when nothing is configured', () => {
    clearAll();
    const platforms = describePlatformStatus();
    expect(platforms.map((p) => p.id)).toEqual([
      'amazon',
      'best-buy',
      'ebay',
      'aliexpress',
      'google-shopping',
      'skimlinks',
      'local-stores',
      'global-fallback',
    ]);
    expect(byId('amazon').status).toBe('search-links-only');
    expect(byId('ebay').status).toBe('not-configured');
    expect(byId('skimlinks').status).toBe('not-configured');
    // Section 20, §12 #51 — Best Buy is recorded rows only, never
    // 'live' (no adapter, credential, or verified call exists).
    expect(byId('best-buy').status).toBe('recorded-prices-only');
    expect(byId('local-stores').status).toBe('live');
  });

  it('marks Amazon tag-only only when its tag is set, and never leaks the tag', () => {
    clearAll();
    setEnv({ [AMAZON_TAG]: 'smartbuy-20' });
    // Section 20, §12 #51 — a set tag is 'tag-only', never
    // 'configured': no Amazon integration works behind the tag.
    expect(byId('amazon').status).toBe('tag-only');
    expect(byId('amazon').coverage).toContain('US');
    expect(JSON.stringify(describePlatformStatus())).not.toContain('smartbuy-20');
  });

  it('marks eBay configured only when both credentials are set', () => {
    clearAll();
    setEnv({ [EBAY_ID]: 'ebay-id', [EBAY_SECRET]: 'ebay-secret' });
    expect(byId('ebay').status).toBe('configured');
    expect(JSON.stringify(describePlatformStatus())).not.toContain('ebay-secret');
  });

  it('marks Skimlinks configured only when its publisher id is set', () => {
    clearAll();
    setEnv({ [SKIMLINKS]: '123456' });
    expect(byId('skimlinks').status).toBe('configured');
  });
});
