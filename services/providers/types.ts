export type ProviderCategory = 'official_api' | 'affiliate_feed' | 'merchant_upload' | 'csv_import' | 'scraping' | 'mock';

export type AvailabilityStatus = 'in_stock' | 'out_of_stock' | 'limited' | 'preorder' | 'unknown';

export interface RawProductData {
  externalId: string;
  retailerSlug: string;
  name: string;
  description?: string;
  brand?: string;
  category?: string;
  gtin?: string;
  images?: string[];
  price: number;
  currency: string;
  availability: AvailabilityStatus;
  url?: string;
  raw?: Record<string, unknown>;
}

export interface ProviderSearchRequest {
  query: string;
  retailerSlug?: string;
  limit?: number;
}

export interface ProviderFetchRequest {
  externalId: string;
  retailerSlug: string;
}

export interface DataProvider {
  readonly key: string;
  readonly name: string;
  readonly category: ProviderCategory;
  isAvailable(): boolean;
  search(request: ProviderSearchRequest): Promise<RawProductData[]>;
  fetch(request: ProviderFetchRequest): Promise<RawProductData | null>;
}
