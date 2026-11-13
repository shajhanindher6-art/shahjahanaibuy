import { logger } from '@/lib/config/logger';
import type {
  DataProvider,
  ProviderFetchRequest,
  ProviderSearchRequest,
  RawProductData,
} from './types';

/**
 * Section 20, §12 #57 — Best Buy adapter scaffolding (code side only).
 *
 * HONEST STATE, READ THIS FIRST:
 *   - There is NO live Best Buy integration. No adapter, credential,
 *     or verified call existed before this file — the old /status
 *     'live' label meant only "seeded merchant_products rows exist".
 *   - This adapter is a fail-closed stub: isAvailable() is false
 *     unless BESTBUY_API_KEY is set, and search()/fetch() return
 *     [] / null even then, because no Best Buy Products API client
 *     is built yet. A set key must never be read as "Best Buy is
 *     live". Building the client (and the owner's API key) is a
 *     separate, owner-approved item.
 */
export const BESTBUY_NOT_CONFIGURED_REASON =
  'Best Buy has no live price integration: no Best Buy Products API client exists yet and no API key is configured. The adapter is registered only so the pipeline can report its status honestly.';

export class BestBuyProvider implements DataProvider {
  readonly key = 'bestbuy';
  readonly name = 'Best Buy';
  readonly category = 'official_api' as const;

  isAvailable(): boolean {
    return Boolean(process.env.BESTBUY_API_KEY?.trim());
  }

  /** Plain-language reason the adapter cannot fetch prices today. */
  getNotConfiguredReason(): string {
    return BESTBUY_NOT_CONFIGURED_REASON;
  }

  async search(_request: ProviderSearchRequest): Promise<RawProductData[]> {
    logger.warn(
      'BestBuyProvider.search — no Best Buy API client exists yet; returning empty, never fake rows'
    );
    return [];
  }

  async fetch(_request: ProviderFetchRequest): Promise<RawProductData | null> {
    logger.warn(
      'BestBuyProvider.fetch — no Best Buy API client exists yet; returning null'
    );
    return null;
  }
}
