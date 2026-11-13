import { logger } from '@/lib/config/logger';
import { ProviderNotConfiguredError } from './errors';
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
  // Sections 21–25, Stage B (B9) — was 'affiliate_feed': there is
  // no feed, only a tag that stamps outbound links. The honest
  // category is 'affiliate_tag_only'.
  readonly category = 'affiliate_tag_only' as const;

  isAvailable(): boolean {
    return Boolean(process.env.AMAZON_CREATORS_API_KEY?.trim());
  }

  /** Plain-language reason the adapter cannot fetch prices today. */
  getNotConfiguredReason(): string | null {
    if (this.isAvailable()) {
      // A set key still means no client: the reason stands, with
      // the key-presence nuance spelled out.
      return (
        'Amazon has no live price integration: the Creators API key is set but no Creators API client exists yet, ' +
        'so the key alone fetches nothing. Only the affiliate tag (AMAZON_ASSOC_TAG) is live, which stamps links — it never fetches prices.'
      );
    }
    return AMAZON_NOT_CONFIGURED_REASON;
  }

  /**
   * Sections 21–25, Stage B (B1) — was a silent `[]`: callers
   * read "no results" and moved on as if Amazon had been
   * checked. There is no client, so a search is not a search —
   * it throws a typed NOT_CONFIGURED error naming the reason.
   */
  async search(_request: ProviderSearchRequest): Promise<RawProductData[]> {
    logger.warn(
      'AmazonProvider.search — no Amazon price client exists (PA-API retired; Creators API not built); throwing NOT_CONFIGURED, never fake rows'
    );
    throw new ProviderNotConfiguredError('amazon', this.getNotConfiguredReason() ?? AMAZON_NOT_CONFIGURED_REASON);
  }

  async fetch(_request: ProviderFetchRequest): Promise<RawProductData | null> {
    logger.warn(
      'AmazonProvider.fetch — no Amazon price client exists (PA-API retired; Creators API not built); throwing NOT_CONFIGURED'
    );
    throw new ProviderNotConfiguredError('amazon', this.getNotConfiguredReason() ?? AMAZON_NOT_CONFIGURED_REASON);
  }
}
