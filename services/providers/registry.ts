import { logger } from '@/lib/config/logger';
import type { DataProvider, ProviderCategory } from './types';
import { MockProvider } from './mock-provider';
import { ApifyProvider } from './apify-provider';
import { CsvProvider } from './csv-provider';
import { AmazonProvider } from './amazon-provider';
import { BestBuyProvider } from './bestbuy-provider';

/**
 * Priority ordering for provider categories. Lower index = higher priority.
 * Used by getPreferred() to select the best available provider.
 */
const CATEGORY_PRIORITY: ProviderCategory[] = [
  'official_api',
  'affiliate_feed',
  'scraping',
  'csv_import',
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
   */
  setRetailerOverride(retailerSlug: string, providerKey: string): void {
    this.retailerOverrides.set(retailerSlug.toLowerCase(), providerKey);
    logger.debug('ProviderRegistry.setRetailerOverride', { retailerSlug, providerKey });
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
   * Get the preferred provider for a specific retailer. If a retailer override
   * is registered and that provider is available, it is returned. Otherwise the
   * global priority ordering is used.
   */
  getForRetailer(retailerSlug: string): DataProvider | undefined {
    const overrideKey = this.retailerOverrides.get(retailerSlug.toLowerCase());
    if (overrideKey) {
      const override = this.providers.get(overrideKey);
      if (override && override.isAvailable()) {
        return override;
      }
      logger.warn('ProviderRegistry.getForRetailer — override unavailable, falling back', {
        retailerSlug,
        overrideKey,
      });
    }

    return this.getPreferred();
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
  if (process.env.NODE_ENV !== 'production') {
    registrySingleton.register(new MockProvider());
  }
  // GUARD (Section 16, #49): ApifyProvider is registered here so
  // the registry knows about it, but it FAILS CLOSED without env
  // vars — ApifyProvider.isAvailable() is false unless BOTH
  // APIFY_API_TOKEN and APIFY_ACTOR_ID are set, and search()/fetch()
  // return empty/null in that case (see services/providers/
  // apify-provider.ts). The vars MUST stay unset: scraping is a
  // hard standing rule (blocked category 10), .env.example lists
  // them as empty placeholders only, and no code anywhere sets
  // them. Registering the provider does not enable scraping; it
  // only keeps the fail-closed path testable. If the vars are ever
  // set, that is an owner decision outside this codebase — do not
  // set them here, in tests, in fixtures, or in .env.example.
  registrySingleton.register(new ApifyProvider());

  // Section 20, §12 #58 — CsvProvider, registered from env config.
  // With CSV_SOURCE_URL unset (the default) isAvailable() is false
  // and the provider is inert: nothing fetches, nothing ingests.
  // The owner configures a real CSV source by setting
  // CSV_SOURCE_URL in the hosting dashboard; see
  // services/data-sources.ts (ensureCsvDataSource) for the
  // data_sources row that records the configured source.
  registrySingleton.register(
    new CsvProvider({ csvUrl: process.env.CSV_SOURCE_URL?.trim() || undefined })
  );

  // Section 20, §12 #57 — Amazon / Best Buy adapter scaffolding.
  // Both are fail-closed stubs (see amazon-provider.ts /
  // bestbuy-provider.ts): no live price client exists for either,
  // so they are never available until their keys exist AND a real
  // client is built. The retailer overrides only matter once a
  // provider IS available; until then getForRetailer falls back
  // to the global ordering, exactly as before.
  registrySingleton.register(new AmazonProvider());
  registrySingleton.register(new BestBuyProvider());
  registrySingleton.setRetailerOverride('amazon', 'amazon');
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
