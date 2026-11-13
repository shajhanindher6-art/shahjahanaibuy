import { logger } from '@/lib/config/logger';
import type {
  DataProvider,
  ProviderFetchRequest,
  ProviderSearchRequest,
  RawProductData,
} from './types';

/**
 * Section 20, §12 #57 — Amazon adapter scaffolding (code side only).
 *
 * HONEST STATE, READ THIS FIRST:
 *   - There is NO live Amazon price integration. The Product
 *     Advertising API 5.0 is RETIRED — no PA-API client is built
 *     here and none is claimed. What exists today is only the
 *     affiliate tag (AMAZON_ASSOC_TAG), which stamps outbound
 *     links; it never fetches a price.
 *   - The Creators API is the only future live path, and it needs
 *     owner approval plus ≥10 qualifying sales in the trailing 30
 *     days. Until the owner holds that approval AND sets
 *     AMAZON_CREATORS_API_KEY, this adapter is NOT available:
 *     isAvailable() is false, search() returns [] and fetch()
 *     returns null — the pipeline reports "no available provider"
 *     instead of pretending Amazon prices were checked.
 *   - When a key IS set one day, search()/fetch() still return
 *     empty/null with a warning: no Creators API client exists
 *     yet, so a set key must never be read as "Amazon is live".
 *     Building that client is a separate, owner-approved item.
 */
export const AMAZON_NOT_CONFIGURED_REASON =
  'Amazon has no live price integration: the Product Advertising API 5.0 is retired, and the Creators API needs owner approval plus ≥10 qualifying sales in 30 days. Only the affiliate tag (AMAZON_ASSOC_TAG) is configured, which stamps links — it never fetches prices.';

export class AmazonProvider implements DataProvider {
  readonly key = 'amazon';
  readonly name = 'Amazon (affiliate tag only)';
  readonly category = 'affiliate_feed' as const;

  isAvailable(): boolean {
    return Boolean(process.env.AMAZON_CREATORS_API_KEY?.trim());
  }

  /** Plain-language reason the adapter cannot fetch prices today. */
  getNotConfiguredReason(): string {
    return AMAZON_NOT_CONFIGURED_REASON;
  }

  async search(_request: ProviderSearchRequest): Promise<RawProductData[]> {
    logger.warn(
      'AmazonProvider.search — no Amazon price client exists (PA-API retired; Creators API not built); returning empty, never fake rows'
    );
    return [];
  }

  async fetch(_request: ProviderFetchRequest): Promise<RawProductData | null> {
    logger.warn(
      'AmazonProvider.fetch — no Amazon price client exists (PA-API retired; Creators API not built); returning null'
    );
    return null;
  }
}
