import { logger } from '@/lib/config/logger';
import {
  ProviderFetchError,
  ProviderNotConfiguredError,
} from './errors';
import type {
  DataProvider,
  ProviderSearchRequest,
  ProviderFetchRequest,
  RawProductData,
  AvailabilityStatus,
} from './types';

/**
 * Apify Actor API response shapes (only the fields we consume).
 */
interface ApifyActorItem {
  [key: string]: unknown;
}

interface ApifyActorRunResponse {
  data?: {
    items?: ApifyActorItem[];
  };
  // Some Apify endpoints return the dataset directly
  items?: ApifyActorItem[];
}

/**
 * Heuristic mapping from an arbitrary Apify item to RawProductData.
 * Apify actors return heterogeneous shapes depending on the scraper, so we
 * look for common field names across popular e-commerce actors.
 */
function mapApifyItem(item: ApifyActorItem, retailerSlug: string): RawProductData | null {
  const getString = (keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = item[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  };

  const getNumber = (keys: string[]): number | undefined => {
    for (const key of keys) {
      const value = item[key];
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string') {
        const parsed = parseFloat(value.replace(/[^0-9.,-]/g, '').replace(',', '.'));
        if (Number.isFinite(parsed)) return parsed;
      }
    }
    return undefined;
  };

  const getArray = (keys: string[]): string[] | undefined => {
    for (const key of keys) {
      const value = item[key];
      if (Array.isArray(value) && value.length > 0) {
        return value.filter((v): v is string => typeof v === 'string');
      }
      if (typeof value === 'string' && value.trim()) {
        return [value.trim()];
      }
    }
    return undefined;
  };

  const externalId =
    getString(['id', 'itemId', 'asin', 'productId', 'sku']) ?? `apify-${Math.random().toString(36).slice(2)}`;
  const name = getString(['title', 'name', 'productName', 'fullName']);
  if (!name) return null; // A product without a name is not usable

  const price = getNumber(['price', 'salePrice', 'currentPrice', 'regularPrice']) ?? 0;
  const currency = getString(['currency', 'currencyCode']) ?? 'USD';

  const availabilityRaw = getString([
    'availability',
    'stockStatus',
    'inStock',
    'availabilityStatus',
  ])?.toLowerCase();

  let availability: AvailabilityStatus = 'unknown';
  if (availabilityRaw) {
    if (availabilityRaw.includes('in stock') || availabilityRaw === 'true') {
      availability = 'in_stock';
    } else if (availabilityRaw.includes('out of stock') || availabilityRaw === 'false') {
      availability = 'out_of_stock';
    } else if (availabilityRaw.includes('limited')) {
      availability = 'limited';
    } else if (availabilityRaw.includes('preorder') || availabilityRaw.includes('pre-order')) {
      availability = 'preorder';
    }
  }

  return {
    externalId,
    retailerSlug,
    name,
    description: getString(['description', 'productDescription', 'shortDescription']),
    brand: getString(['brand', 'manufacturer', 'sellerName']),
    category: getString(['category', 'categoryName', 'breadcrumb', 'productType']),
    gtin: getString(['gtin', 'upc', 'ean', 'isbn']),
    images: getArray(['images', 'image', 'imageUrl', 'imageUrls', 'gallery']),
    price,
    currency,
    availability,
    url: getString(['url', 'link', 'productUrl', 'canonicalUrl']),
    raw: item as Record<string, unknown>,
  };
}

/**
 * Sections 21–25, Stage B (B8) — Apify is REJECTED / BANNED, never
 * an approved provider. The standing no-scraping rule bans it; the
 * old "Approved data collection provider" copy (lib/config/
 * providers.ts) said the opposite. The vars MUST stay unset. This
 * reason is the single source of truth for every surface that
 * mentions Apify.
 */
export const APIFY_NOT_CONFIGURED_REASON =
  'Apify is rejected: scraping is banned by the standing no-scraping rule, so APIFY_API_TOKEN / APIFY_ACTOR_ID must stay unset. Apify is never a data source for SmartBuy.';

/** Sections 21–25, Stage B (B6) — same shape as eBay: 10s timeout. */
export const APIFY_FETCH_TIMEOUT_MS = 10_000;

/**
 * Data provider backed by Apify's Actor run API.
 * Available only when both APIFY_API_TOKEN and APIFY_ACTOR_ID env vars are set.
 * BANNED in practice: the standing no-scraping rule means the vars
 * must stay unset (see APIFY_NOT_CONFIGURED_REASON). The provider
 * stays registered only so the fail-closed path is testable.
 */
export class ApifyProvider implements DataProvider {
  readonly key = 'apify';
  readonly name = 'Apify Provider';
  readonly category = 'scraping' as const;

  private readonly token: string | undefined;
  private readonly actorId: string | undefined;
  private readonly baseUrl: string;

  constructor() {
    this.token = process.env.APIFY_API_TOKEN;
    this.actorId = process.env.APIFY_ACTOR_ID;
    this.baseUrl = process.env.APIFY_API_BASE_URL ?? 'https://api.apify.com/v2';
  }

  isAvailable(): boolean {
    return Boolean(this.token && this.actorId);
  }

  /** Sections 21–25, Stage B (B2) — Apify is banned, never merely unconfigured. */
  getNotConfiguredReason(): string | null {
    return this.isAvailable() ? null : APIFY_NOT_CONFIGURED_REASON;
  }

  private async runActor(input: Record<string, unknown>): Promise<ApifyActorItem[]> {
    if (!this.isAvailable() || !this.token || !this.actorId) {
      throw new ProviderNotConfiguredError('apify', APIFY_NOT_CONFIGURED_REASON);
    }

    // Section 20, §12 #99 — the token travels as an Authorization
    // header, never as a `?token=` URL query param (a query param
    // lands in access logs). Apify's API accepts Bearer auth.
    const runUrl = `${this.baseUrl}/acts/${this.actorId}/run-sync-get-dataset-items`;

    let response: Response;
    try {
      response = await fetch(runUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
        // Sections 21–25, Stage B (B6) — 10s timeout, same as eBay.
        signal: AbortSignal.timeout(APIFY_FETCH_TIMEOUT_MS),
      });
    } catch (error) {
      logger.error('ApifyProvider.runActor — request failed', { error: String(error) });
      throw new ProviderFetchError('apify', `Apify actor call failed: ${String(error)}`);
    }

    if (!response.ok) {
      logger.error('ApifyProvider.runActor — non-OK response', {
        status: response.status,
        statusText: response.statusText,
      });
      throw new ProviderFetchError(
        'apify',
        `Apify actor call failed: HTTP ${response.status} ${response.statusText}`
      );
    }

    const json = (await response.json()) as ApifyActorRunResponse;
    // Sections 21–25, Stage B (B6) — size cap: never accept more
    // items than asked for.
    const items = json.items ?? json.data?.items ?? [];
    const maxItems = typeof input.maxItems === 'number' && input.maxItems > 0 ? input.maxItems : 20;
    return items.slice(0, maxItems);
  }

  async search(request: ProviderSearchRequest): Promise<RawProductData[]> {
    // Sections 21–25, Stage B (B1) — was a silent [] when
    // unconfigured. Throwing names the ban instead.
    if (!this.isAvailable()) {
      throw new ProviderNotConfiguredError('apify', APIFY_NOT_CONFIGURED_REASON);
    }

    logger.debug('ApifyProvider.search', {
      query: request.query,
      retailerSlug: request.retailerSlug,
    });

    const items = await this.runActor({
      search: request.query,
      maxItems: request.limit ?? 20,
      retailerSlug: request.retailerSlug,
    });

    const retailerSlug = request.retailerSlug ?? 'unknown';
    return items
      .map((item) => mapApifyItem(item, retailerSlug))
      .filter((p): p is RawProductData => p !== null);
  }

  async fetch(request: ProviderFetchRequest): Promise<RawProductData | null> {
    // Sections 21–25, Stage B (B1) — was a silent null when
    // unconfigured. Throwing names the ban instead.
    if (!this.isAvailable()) {
      throw new ProviderNotConfiguredError('apify', APIFY_NOT_CONFIGURED_REASON);
    }

    logger.debug('ApifyProvider.fetch', {
      externalId: request.externalId,
      retailerSlug: request.retailerSlug,
    });

    const items = await this.runActor({
      productId: request.externalId,
      retailerSlug: request.retailerSlug,
      maxItems: 1,
    });

    if (items.length === 0) return null;
    return mapApifyItem(items[0], request.retailerSlug);
  }
}
