import { logger } from '@/lib/config/logger';
import {
  isEbayConfigured,
  searchEbayListings,
  type EbayListing,
} from '@/services/ebay-browse';
import { ProviderFetchError, ProviderNotConfiguredError } from './errors';
import type {
  DataProvider,
  ProviderFetchRequest,
  ProviderSearchRequest,
  RawProductData,
} from './types';

/**
 * Retailers Delta — eBay registry adapter (SERVER-ONLY).
 *
 * A thin DataProvider wrapper over the existing eBay Browse
 * adapter (services/ebay-browse.ts). eBay lived OUTSIDE the
 * registry (the refresh chain calls searchEbayListings directly
 * as step 0); this file registers it so getForRetailer('ebay')
 * resolves and the /api/retailers/sync route can address it
 * through the same provider surface as Best Buy / Walmart.
 *
 * NO duplicated logic: OAuth, token caching, the 0.85 matcher
 * and GTIN extraction all stay in services/ebay-browse.ts
 * (and services/ebay-refresh.ts for the refresh leg). This
 * wrapper only translates between the DataProvider interface
 * and searchEbayListings' result shape.
 *
 * FAIL-CLOSED exactly as ebay-browse is: missing
 * EBAY_CLIENT_ID / EBAY_CLIENT_SECRET → isAvailable() false,
 * search()/fetch() throw ProviderNotConfiguredError. The
 * merchants-row + EPN + Growth Check gates live in the refresh
 * leg (services/ebay-refresh.ts), not here — this adapter
 * answers "can we call Browse", nothing more.
 *
 * MAPPING NOTES:
 * - A listing with no parseable price cannot become a
 *   RawProductData (price is required) — it is skipped, never
 *   recorded with a guessed price.
 * - Browse itemSummary search carries no stock field, so
 *   availability is 'unknown' — never guessed from the
 *   condition or the title.
 * - Currency falls back to 'USD' only because the marketplace
 *   defaults to EBAY_US (services/ebay-browse.ts); a listing
 *   that carries its own currency always wins.
 * - fetch() is NOT supported by the underlying adapter:
 *   ebay-browse.ts exposes keyword search only — the Browse
 *   getItem single-lookup endpoint would need the OAuth token,
 *   which is not exported. fetch() therefore returns null
 *   ("not found") rather than inventing a search. When a
 *   getItem leg is added to ebay-browse.ts, this fetch must
 *   delegate to it.
 */

export const EBAY_NOT_CONFIGURED_REASON =
  'eBay has no live price integration: no API credentials are configured (EBAY_CLIENT_ID + EBAY_CLIENT_SECRET are unset). The adapter is built, but without the keys from the eBay developer dashboard it fetches nothing — never a fake listing.';

type FetchFn = typeof fetch;

export interface EbayProviderOptions {
  /** Test-only fetch override, passed through to searchEbayListings; production uses the global fetch. */
  fetchFn?: FetchFn;
}

/** Map one eBay listing to RawProductData; null when it cannot honestly become a product. */
function toRawProduct(listing: EbayListing): RawProductData | null {
  if (listing.price === null) return null;
  const product: RawProductData = {
    externalId: listing.itemId,
    retailerSlug: 'ebay',
    name: listing.title,
    price: listing.price,
    // Marketplace default is EBAY_US (see ebay-browse.ts); the
    // listing's own currency always wins when present.
    currency: listing.currency ?? 'USD',
    // Browse search carries no stock field — unknown, never guessed.
    availability: 'unknown',
    url: listing.itemWebUrl,
    raw: { itemId: listing.itemId, condition: listing.condition },
  };
  if (listing.gtin) product.gtin = listing.gtin;
  if (listing.imageUrl) product.images = [listing.imageUrl];
  return product;
}

export class EbayProvider implements DataProvider {
  readonly key = 'ebay';
  readonly name = 'eBay';
  readonly category = 'official_api' as const;

  private readonly fetchFn: FetchFn | undefined;

  constructor(options?: EbayProviderOptions) {
    this.fetchFn = options?.fetchFn;
  }

  isAvailable(): boolean {
    return isEbayConfigured();
  }

  /** Plain-language reason the adapter cannot fetch prices today; null when it can. */
  getNotConfiguredReason(): string | null {
    if (this.isAvailable()) return null;
    return EBAY_NOT_CONFIGURED_REASON;
  }

  /**
   * Keyword search through the Browse API. A blank query is an
   * empty result, not a call. A not-configured adapter throws
   * (registry providers throw, unlike searchEbayListings which
   * returns a reason object); rate-limit / API failures become
   * ProviderFetchError.
   */
  async search(request: ProviderSearchRequest): Promise<RawProductData[]> {
    const query = typeof request.query === 'string' ? request.query.trim() : '';
    if (query === '') return [];
    if (!this.isAvailable()) {
      throw new ProviderNotConfiguredError('ebay', this.getNotConfiguredReason() ?? EBAY_NOT_CONFIGURED_REASON);
    }
    const result = await searchEbayListings(query, {
      limit: request.limit,
      fetchFn: this.fetchFn,
    });
    if (!result.ok) {
      if (result.reason === 'not-configured') {
        throw new ProviderNotConfiguredError('ebay', this.getNotConfiguredReason() ?? EBAY_NOT_CONFIGURED_REASON);
      }
      if (result.reason === 'invalid-query') return [];
      logger.warn('ebay-provider: search failed', { reason: result.reason, query });
      throw new ProviderFetchError('ebay', `eBay search failed (${result.reason})`);
    }
    const mapped: RawProductData[] = [];
    for (const listing of result.listings) {
      const product = toRawProduct(listing);
      if (product) mapped.push(product);
    }
    return mapped;
  }

  /**
   * Single-item lookup is NOT supported by the underlying
   * adapter (services/ebay-browse.ts exposes keyword search
   * only; the Browse getItem endpoint needs the unexported
   * OAuth token). Returns null rather than inventing a search
   * for the item id. Throws NOT_CONFIGURED when unconfigured.
   */
  async fetch(_request: ProviderFetchRequest): Promise<RawProductData | null> {
    if (!this.isAvailable()) {
      throw new ProviderNotConfiguredError('ebay', this.getNotConfiguredReason() ?? EBAY_NOT_CONFIGURED_REASON);
    }
    return null;
  }
}
