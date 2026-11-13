import { env } from '@/lib/config/env';
import { logger } from '@/lib/config/logger';
import { logProviderConfigIssues } from '@/services/provider-config';
import { ProviderNotConfiguredError } from './errors';
import type { DataProvider, ProviderCategory } from './types';
import { MockProvider } from './mock-provider';
import { ApifyProvider } from './apify-provider';
import { CsvProvider } from './csv-provider';
import { AmazonProvider } from './amazon-provider';
import { BestBuyProvider } from './bestbuy-provider';
import {
  canonicalMerchantSlug,
  merchantSlugForProviderKey,
  providerKeyForMerchantSlug,
} from '@/lib/merchant-slugs';

/**
 * Priority ordering for provider categories. Lower index = higher priority.
 * Used by getPreferred() to select the best available provider.
 *
 * Sections 21–25, Stage B (B9): 'affiliate_tag_only' sits BELOW
 * csv_import — a tag stamps links, it fetches no data, so it must
 * never outrank a provider that can actually return rows.
 */
const CATEGORY_PRIORITY: ProviderCategory[] = [
  'official_api',
  'affiliate_feed',
  'csv_import',
  'affiliate_tag_only',
  'scraping',
  'merchant_upload',
  'mock',
];

/**
 * Registry of data providers. Allows the platform to look up providers by key,
 * category, or retailer, and to select the highest-priority available provider
 * for a given context.
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, DataProvider>();

  /**
   * Retailer-specific provider overrides. If a retailer has a preferred
   * provider key registered here, that provider is returned by getForRetailer
   * instead of the global priority ordering.
   */
  private readonly retailerOverrides = new Map<string, string>();

  /**
   * Register a provider. If a provider with the same key already exists it is
   * replaced and a warning is logged.
   */
  register(provider: DataProvider): void {
    if (this.providers.has(provider.key)) {
      logger.warn('ProviderRegistry.register — overwriting existing provider', {
        key: provider.key,
      });
    }
    this.providers.set(provider.key, provider);
    logger.debug('ProviderRegistry.register', {
      key: provider.key,
      name: provider.name,
      category: provider.category,
    });
  }

  /**
   * Remove a provider from the registry.
   */
  unregister(key: string): boolean {
    return this.providers.delete(key);
  }

  /**
   * Register a preferred provider key for a specific retailer slug.
   * FINAL 100% (F-P2-06): the slug is canonicalized first
   * (lib/merchant-slugs.ts) — 'bestbuy' and 'best-buy' register
   * the same override, so a lookup under either spelling finds it.
   */
  setRetailerOverride(retailerSlug: string, providerKey: string): void {
    const canonical = canonicalMerchantSlug(retailerSlug) ?? retailerSlug.toLowerCase();
    this.retailerOverrides.set(canonical, providerKey);
    // Keep the provider-key spelling as a second entry so a
    // caller passing the raw provider key ('bestbuy') also hits.
    const keySpelling = providerKeyForMerchantSlug(retailerSlug) ?? providerKey.toLowerCase();
    if (keySpelling !== canonical) this.retailerOverrides.set(keySpelling, providerKey);
    logger.debug('ProviderRegistry.setRetailerOverride', {
      retailerSlug,
      canonicalRetailerSlug: canonical,
      providerKey,
    });
  }

  /**
   * Get a provider by its key, or undefined if not registered.
   */
  get(key: string): DataProvider | undefined {
    return this.providers.get(key);
  }

  /**
   * Get all registered providers (including unavailable ones).
   */
  getAll(): DataProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get all providers that are currently available.
   */
  getAvailable(): DataProvider[] {
    return this.getAll().filter((p) => p.isAvailable());
  }

  /**
   * Get all providers in a given category.
   */
  getByCategory(category: ProviderCategory): DataProvider[] {
    return this.getAll().filter((p) => p.category === category);
  }

  /**
   * Get the highest-priority available provider across all categories.
 * Priority: official_api > affiliate_feed > scraping > csv_import > merchant_upload > mock.
   */
  getPreferred(): DataProvider | undefined {
    for (const category of CATEGORY_PRIORITY) {
      const provider = this.getAvailable()
        .find((p) => p.category === category);
      if (provider) return provider;
    }
    return undefined;
  }

  /**
   * Get the preferred provider for a specific retailer.
   *
   * Sections 21–25, Stage B (B5) — NO silent cross-merchant
   * fallback. The old code returned the global preferred provider
   * when the retailer's override was unavailable, so a request
   * for merchant X could be served by merchant Y's adapter with
   * only a warn log. Now: an override that is unavailable returns
   * undefined (the caller reports "no provider for <retailer>"),
   * and a retailer with no override at all also returns
   * undefined — the caller must say so, not quietly serve
   * another merchant's data. Use requireForRetailer() when the
   * caller wants the failure as a typed error.
   */
  getForRetailer(retailerSlug: string): DataProvider | undefined {
    // FINAL 100% (F-P2-06/F-P1-11): reconcile the slug first —
    // the merchants table says 'best-buy', the provider key says
    // 'bestbuy'. Both spellings resolve to the same override.
    const canonical = canonicalMerchantSlug(retailerSlug) ?? retailerSlug.toLowerCase();
    const overrideKey =
      this.retailerOverrides.get(canonical) ??
      this.retailerOverrides.get(retailerSlug.toLowerCase()) ??
      this.retailerOverrides.get(merchantSlugForProviderKey(retailerSlug) ?? '');
    if (!overrideKey) {
      logger.warn('ProviderRegistry.getForRetailer — no provider override for retailer', {
        retailerSlug,
        canonicalRetailerSlug: canonical,
      });
      return undefined;
    }
    const override = this.providers.get(overrideKey);
    if (override && override.isAvailable()) {
      return override;
    }
    logger.warn('ProviderRegistry.getForRetailer — override unavailable, no fallback to another merchant', {
      retailerSlug,
      overrideKey,
    });
    return undefined;
  }

  /**
   * Sections 21–25, Stage B (B5) — like getForRetailer, but the
   * failure is a typed error naming the requested merchant, so
   * callers can surface it instead of silently serving another
   * merchant's data.
   */
  requireForRetailer(retailerSlug: string): DataProvider {
    const provider = this.getForRetailer(retailerSlug);
    if (provider) return provider;
    const overrideKey = this.retailerOverrides.get(retailerSlug.toLowerCase());
    const override = overrideKey ? this.providers.get(overrideKey) : undefined;
    const reason =
      override?.getNotConfiguredReason() ??
      `No provider is configured for merchant '${retailerSlug}' — no silent fallback to another merchant is allowed.`;
    throw new ProviderNotConfiguredError(overrideKey ?? retailerSlug, reason);
  }
}

/**
 * Shared singleton registry instance, lazily initialized on first access.
 */
let registrySingleton: ProviderRegistry | null = null;

/**
 * Singleton factory. Returns the shared ProviderRegistry instance, registering
 * the ApifyProvider on first call (plus the MockProvider outside production).
 *
 * Section 20, §12 #57 + #58 — the registry also holds the CSV provider
 * (from CSV_SOURCE_URL; unavailable until the owner configures a source)
 * and the Amazon / Best Buy adapter scaffolding (fail-closed until their
 * keys exist AND a real client is built). Registering an unavailable
 * provider changes nothing about selection: getAvailable() /
 * getPreferred() only ever return providers whose isAvailable() is true,
 * so with no source configured the pipeline still reports
 * "no available provider" honestly.
 *
 * SECURITY (2026-11-05): the MockProvider is NEVER registered in production.
 * It was always available and, with no real provider configured, became the
 * selected provider — so an admin (previously: any signed-in user) data
 * refresh inserted fake products into the live catalog. In production with
 * no real provider, getPreferred() returns undefined and product.fetch
 * fails cleanly with "No available provider for product.fetch".
 */
export function getProviderRegistry(): ProviderRegistry {
  if (registrySingleton) return registrySingleton;

  registrySingleton = new ProviderRegistry();
  // Sections 21–25, Stage B (B10) — validate provider config at
  // startup: bad/missing config is named at boot (warn/error
  // logs), never discovered mid-refresh. Never throws — no
  // provider is critical.
  logProviderConfigIssues();
  if (process.env.NODE_ENV !== 'production') {
    registrySingleton.register(new MockProvider());
  }
  // KILL-SWITCH (Final 100%, F-P1-59): ApifyProvider is registered
  // here so the registry knows about it, but it is HARD-DEAD —
  // ApifyProvider.isAvailable() returns false unconditionally and
  // the constructor never reads APIFY_API_TOKEN / APIFY_ACTOR_ID,
  // so no Vercel env edit can activate scraping. search()/fetch()
  // THROW a typed NOT_CONFIGURED error naming the ban (see
  // services/providers/apify-provider.ts). Scraping is a hard
  // standing rule — Apify is REJECTED / BANNED, never an approved
  // provider (Sections 21–25, Stage B, B8) — .env.example lists
  // the vars as empty placeholders only, and no code anywhere
  // sets them. Registering the provider does not enable scraping;
  // it only keeps the fail-closed path testable.
  registrySingleton.register(new ApifyProvider());

  // Section 20, §12 #58 — CsvProvider, registered from env config.
  // With CSV_SOURCE_URL unset (the default) isAvailable() is false
  // and the provider is inert: nothing fetches, nothing ingests.
  // The owner configures a real CSV source by setting
  // CSV_SOURCE_URL in the hosting dashboard; see
  // services/data-sources.ts (ensureCsvDataSource) for the
  // data_sources row that records the configured source.
  registrySingleton.register(
    new CsvProvider({ csvUrl: env.csvSourceUrl?.trim() || undefined })
  );

  // Section 20, §12 #57 — Amazon adapter scaffolding; Best Buy
  // now has a real client (services/providers/bestbuy-provider.ts).
  // Amazon is still a fail-closed stub (see amazon-provider.ts):
  // no live price client exists for it, so it is never available
  // until its key exists AND a real client is built — and even
  // with a key, search()/fetch() throw NOT_CONFIGURED
  // (Sections 21–25, Stage B, B1). Best Buy is key-gated only:
  // with BESTBUY_API_KEY set its search()/fetch() call the live
  // Products API. The retailer overrides only matter once a
  // provider IS available; until then getForRetailer returns
  // undefined for that retailer — never another merchant's
  // provider (B5).
  registrySingleton.register(new AmazonProvider());
  registrySingleton.register(new BestBuyProvider());
  registrySingleton.setRetailerOverride('amazon', 'amazon');
  // FINAL 100% (F-P2-06): register under BOTH spellings — the
  // canonical merchants slug 'best-buy' and the provider key
  // 'bestbuy' — so getForRetailer('best-buy') and
  // getForRetailer('bestbuy') agree. setRetailerOverride
  // canonicalizes, so these two calls land on the same entries.
  registrySingleton.setRetailerOverride('best-buy', 'bestbuy');
  registrySingleton.setRetailerOverride('bestbuy', 'bestbuy');

  logger.info('ProviderRegistry initialized', {
    providers: registrySingleton.getAll().map((p) => p.key),
  });

  return registrySingleton;
}

/**
 * Reset the singleton. Intended for tests only.
 */
export function resetProviderRegistry(): void {
  registrySingleton = null;
}
