import { logger } from '@/lib/config/logger';
import type {
  DataProvider,
  ProviderSearchRequest,
  ProviderFetchRequest,
  RawProductData,
} from './types';

/**
 * Mock data provider that returns a fixed catalog of realistic-looking products.
 * Always available — used as a fallback when no real providers are configured
 * and for local development / testing.
 */
const MOCK_PRODUCTS: RawProductData[] = [
  {
    externalId: 'mock-001',
    retailerSlug: 'amazon',
    name: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones',
    description:
      'Industry-leading noise cancellation with two processors controlling eight microphones. Up to 30 hours of battery life and quick charging.',
    brand: 'Sony',
    category: 'Electronics > Headphones',
    gtin: '027242920918',
    images: [
      'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800',
      'https://images.unsplash.com/photo-1583394838336-acd977736f90?w=800',
    ],
    price: 398.0,
    currency: 'USD',
    availability: 'in_stock',
    url: 'https://www.amazon.com/dp/B09XS7JWHH',
    raw: { source: 'mock' },
  },
  {
    externalId: 'mock-002',
    retailerSlug: 'amazon',
    name: 'Apple AirPods Pro (2nd Generation)',
    description:
      'Up to 2x more Active Noise Cancellation. Adaptive Transparency. Personalized Spatial Audio with dynamic head tracking.',
    brand: 'Apple',
    category: 'Electronics > Earbuds',
    gtin: '194253403870',
    images: [
      'https://images.unsplash.com/photo-1606220588913-b3aacb4d2f46?w=800',
      'https://images.unsplash.com/photo-1600294037681-c80b4cb5b434?w=800',
    ],
    price: 249.0,
    currency: 'USD',
    availability: 'in_stock',
    url: 'https://www.amazon.com/dp/B0BDHWDR12',
    raw: { source: 'mock' },
  },
  {
    externalId: 'mock-003',
    retailerSlug: 'bestbuy',
    name: 'Samsung Galaxy S23 Ultra 5G 256GB (Unlocked)',
    description:
      '6.8-inch Dynamic AMOLED 2X display, 200MP camera with advanced nightography, Snapdragon 8 Gen 2 for Galaxy, and integrated S Pen.',
    brand: 'Samsung',
    category: 'Electronics > Cell Phones',
    gtin: '887276825472',
    images: [
      'https://images.unsplash.com/photo-1610945265331-345c1f0b7b51?w=800',
    ],
    price: 1199.99,
    currency: 'USD',
    availability: 'limited',
    url: 'https://www.bestbuy.com/site/samsung-galaxy-s23-ultra/6521350.p',
    raw: { source: 'mock' },
  },
  {
    externalId: 'mock-004',
    retailerSlug: 'target',
    name: 'Dyson V15 Detect Cordless Vacuum',
    description:
      'Laser detects microscopic dust. LCD screen shows scientific proof of a deep clean. 60 minutes of fade-free power.',
    brand: 'Dyson',
    category: 'Home > Vacuums',
    gtin: '886601020683',
    images: [
      'https://images.unsplash.com/photo-1558317374-067fb5f30001?w=800',
    ],
    price: 749.99,
    currency: 'USD',
    availability: 'in_stock',
    url: 'https://www.target.com/p/dyson-v15-detect-cordless-vacuum/-/A-82514808',
    raw: { source: 'mock' },
  },
  {
    externalId: 'mock-005',
    retailerSlug: 'aliexpress',
    name: 'Xiaomi Mi Band 7 Fitness Tracker',
    description:
      '1.62" AMOLED display, 24-hour heart rate monitoring, SpO2 measurement, and up to 14 days of battery life on a single charge.',
    brand: 'Xiaomi',
    category: 'Electronics > Wearables',
    gtin: '6934177779335',
    images: [
      'https://images.unsplash.com/photo-1575311373937-040b8e1fd5b6?w=800',
    ],
    price: 59.99,
    currency: 'USD',
    availability: 'preorder',
    url: 'https://www.aliexpress.com/item/xiaomi-mi-band-7/1005004462837861.html',
    raw: { source: 'mock' },
  },
];

export class MockProvider implements DataProvider {
  readonly key = 'mock';
  readonly name = 'Mock Provider';
  readonly category = 'mock' as const;

  private readonly products: RawProductData[];

  constructor(products: RawProductData[] = MOCK_PRODUCTS) {
    this.products = products;
  }

  isAvailable(): boolean {
    return true;
  }

  async search(request: ProviderSearchRequest): Promise<RawProductData[]> {
    logger.debug('MockProvider.search', { query: request.query, retailerSlug: request.retailerSlug });

    const query = request.query.trim().toLowerCase();
    const retailerSlug = request.retailerSlug?.trim().toLowerCase();

    let results = this.products;

    if (retailerSlug) {
      results = results.filter(
        (p) => p.retailerSlug.toLowerCase() === retailerSlug,
      );
    }

    if (query) {
      results = results.filter((p) => {
        const haystack = [p.name, p.description ?? '', p.brand ?? '', p.category ?? '']
          .join(' ')
          .toLowerCase();
        return query.split(/\s+/).every((term) => haystack.includes(term));
      });
    }

    if (typeof request.limit === 'number' && request.limit > 0) {
      results = results.slice(0, request.limit);
    }

    return results;
  }

  async fetch(request: ProviderFetchRequest): Promise<RawProductData | null> {
    logger.debug('MockProvider.fetch', {
      externalId: request.externalId,
      retailerSlug: request.retailerSlug,
    });

    return (
      this.products.find(
        (p) =>
          p.externalId === request.externalId &&
          p.retailerSlug.toLowerCase() === request.retailerSlug.toLowerCase(),
      ) ?? null
    );
  }
}
