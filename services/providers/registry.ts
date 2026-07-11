import { logger } from '@/lib/config/logger';
import type { DataProvider, ProviderCategory } from './types';
import { MockProvider } from './mock-provider';
import { ApifyProvider } from './apify-provider';

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
 * the MockProvider and ApifyProvider on first call. Additional providers (e.g.
 * CsvProvider, affiliate feeds) can be registered on the returned instance.
 */
export function getProviderRegistry(): ProviderRegistry {
  if (registrySingleton) return registrySingleton;

  registrySingleton = new ProviderRegistry();
  registrySingleton.register(new MockProvider());
  registrySingleton.register(new ApifyProvider());

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
