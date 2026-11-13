import { env } from '@/lib/config/env';
import { logger } from '@/lib/config/logger';
import { ProviderNotConfiguredError } from './errors';
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
    return Boolean(env.bestbuyApiKey?.trim());
  }

  /** Plain-language reason the adapter cannot fetch prices today. */
  getNotConfiguredReason(): string | null {
    if (this.isAvailable()) {
      // A set key still means no client: the reason stands, with
      // the key-presence nuance spelled out.
      return 'Best Buy has no live price integration: the API key is set but no Best Buy Products API client exists yet, so the key alone fetches nothing.';
    }
    return BESTBUY_NOT_CONFIGURED_REASON;
  }

  /**
   * Sections 21–25, Stage B (B1) — was a silent `[]` / `null`:
   * callers read "no results" as if Best Buy had been checked.
   * There is no client, so search/fetch throw a typed
   * NOT_CONFIGURED error naming the reason.
   */
  async search(_request: ProviderSearchRequest): Promise<RawProductData[]> {
    logger.warn(
      'BestBuyProvider.search — no Best Buy API client exists yet; throwing NOT_CONFIGURED, never fake rows'
    );
    throw new ProviderNotConfiguredError('bestbuy', this.getNotConfiguredReason() ?? BESTBUY_NOT_CONFIGURED_REASON);
  }

  async fetch(_request: ProviderFetchRequest): Promise<RawProductData | null> {
    logger.warn(
      'BestBuyProvider.fetch — no Best Buy API client exists yet; throwing NOT_CONFIGURED'
    );
    throw new ProviderNotConfiguredError('bestbuy', this.getNotConfiguredReason() ?? BESTBUY_NOT_CONFIGURED_REASON);
  }
}
