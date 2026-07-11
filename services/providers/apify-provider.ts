import { logger } from '@/lib/config/logger';
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
 * Data provider backed by Apify's Actor run API.
 * Available only when both APIFY_API_TOKEN and APIFY_ACTOR_ID env vars are set.
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

  private async runActor(input: Record<string, unknown>): Promise<ApifyActorItem[]> {
    if (!this.isAvailable() || !this.token || !this.actorId) {
      return [];
    }

    const runUrl = `${this.baseUrl}/acts/${this.actorId}/run-sync-get-dataset-items?token=${encodeURIComponent(this.token)}`;

    try {
      const response = await fetch(runUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        logger.error('ApifyProvider.runActor — non-OK response', {
          status: response.status,
          statusText: response.statusText,
        });
        return [];
      }

      const json = (await response.json()) as ApifyActorRunResponse;
      return json.items ?? json.data?.items ?? [];
    } catch (error) {
      logger.error('ApifyProvider.runActor — request failed', { error: String(error) });
      return [];
    }
  }

  async search(request: ProviderSearchRequest): Promise<RawProductData[]> {
    if (!this.isAvailable()) {
      logger.debug('ApifyProvider.search — provider unavailable, returning empty');
      return [];
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
    if (!this.isAvailable()) {
      logger.debug('ApifyProvider.fetch — provider unavailable, returning null');
      return null;
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
