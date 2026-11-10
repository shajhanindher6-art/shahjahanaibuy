/**
 * Press + status page facts (Section 9, chunk 4).
 *
 * Locks the numbers the /press fact sheet publishes to the repo
 * sources they come from, so a future store / region / language /
 * currency change fails loudly here instead of silently leaving
 * /press stale. The expected values below MUST match the FACTS array
 * in app/press/page.tsx — that page module is deliberately not
 * imported here (it pulls the React site header/footer), so keep the
 * two in sync by hand and let this test catch the drift on the source
 * side.
 *
 * The test count is NOT asserted here: it is the result of a full
 * `npx vitest run` (1,180 passing, 111 files, 10 November 2026) and
 * any new test file — including this one — moves that total. The
 * press page dates it instead of presenting it as permanent.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { LOCAL_STORES, GLOBAL_STORES } from '@/lib/stores';
import { REGIONS, SUPPORTED_LANGUAGES } from '@/lib/region';
import { USD_PER_UNIT } from '@/services/currency';
import { POSTS } from '@/lib/blog/posts';
import { isEbayConfigured } from '@/services/ebay-browse';
import {
  getConfiguredAmazonLocales,
  getSkimlinksPublisherId,
} from '@/services/affiliate-geo';
import { describePlatformStatus } from '@/services/platform-status';

// Published on /press (app/press/page.tsx FACTS). If a source count
// below changes, update the press page in the same change.
const PUBLISHED = {
  localStores: 80,
  globalFallbackStores: 4,
  regions: 61,
  countriesWithLocalStore: 60,
  languages: 20,
  currencies: 51,
  blogArticles: 20,
} as const;

describe('press fact sheet — numbers trace to repo sources', () => {
  it('stores: 80 local stores + 4 global fallback stores', () => {
    expect(LOCAL_STORES).toHaveLength(PUBLISHED.localStores);
    expect(GLOBAL_STORES).toHaveLength(PUBLISHED.globalFallbackStores);
    // The global fallbacks are the four named on /press.
    expect(GLOBAL_STORES.map((s) => s.name).sort()).toEqual(
      ['AliExpress', 'Amazon', 'eBay', 'Google Shopping'].sort(),
    );
  });

  it('regions: 61, of which 60 have a local store (South Africa does not)', () => {
    expect(REGIONS).toHaveLength(PUBLISHED.regions);
    const countriesWithStores = new Set(LOCAL_STORES.map((s) => s.countryCode));
    expect(countriesWithStores.size).toBe(PUBLISHED.countriesWithLocalStore);
    const withoutStore = REGIONS.filter((r) => !countriesWithStores.has(r.code));
    expect(withoutStore.map((r) => r.code)).toEqual(['ZA']);
  });

  it('languages: 20 supported UI languages', () => {
    expect(SUPPORTED_LANGUAGES).toHaveLength(PUBLISHED.languages);
  });

  it('currencies: 51 in the static FX table', () => {
    expect(Object.keys(USD_PER_UNIT)).toHaveLength(PUBLISHED.currencies);
  });

  it('blog: 20 original English guides', () => {
    expect(POSTS).toHaveLength(PUBLISHED.blogArticles);
  });

  it('platform status directory entry agrees with the press numbers', () => {
    const directory = describePlatformStatus().find((p) => p.id === 'local-stores');
    expect(directory).toBeDefined();
    expect(directory!.coverage).toContain(`${PUBLISHED.localStores} stores`);
    expect(directory!.coverage).toContain(`${PUBLISHED.regions} regions`);
  });
});

// Section 9, chunk 4 — the /status "Services & integrations" section
// must never report an unconfigured integration as live. With no
// credentials in the environment (the state this repo ships in),
// every integration check must come back negative.
const INTEGRATION_ENV = ['EBAY_CLIENT_ID', 'EBAY_CLIENT_SECRET', 'SKIMLINKS_PUBLISHER_ID', 'AMAZON_ASSOC_TAG'] as const;

const savedEnv: Record<string, string | undefined> = {};
for (const key of INTEGRATION_ENV) savedEnv[key] = process.env[key];

function clearIntegrationEnv() {
  for (const key of INTEGRATION_ENV) delete process.env[key];
}

describe('status page — integrations report honestly when unconfigured', () => {
  afterEach(() => {
    for (const key of INTEGRATION_ENV) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('eBay is not configured without credentials', () => {
    clearIntegrationEnv();
    expect(isEbayConfigured()).toBe(false);
    const ebay = describePlatformStatus().find((p) => p.id === 'ebay');
    expect(ebay!.status).toBe('not-configured');
  });

  it('Skimlinks reports no account without a publisher id', () => {
    clearIntegrationEnv();
    expect(getSkimlinksPublisherId()).toBeNull();
    const skimlinks = describePlatformStatus().find((p) => p.id === 'skimlinks');
    // "Pending approval" means no account yet — never "configured".
    expect(skimlinks!.status).toBe('pending-approval');
    expect(skimlinks!.whatYouGet).toContain('No Skimlinks account yet');
  });

  it('no Amazon associate locale is covered without tags', () => {
    clearIntegrationEnv();
    expect(getConfiguredAmazonLocales()).toEqual([]);
    const amazon = describePlatformStatus().find((p) => p.id === 'amazon');
    expect(amazon!.status).toBe('search-links-only');
  });
});
