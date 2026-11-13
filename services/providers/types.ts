/**
 * Sections 21–25, Stage B (B9) — 'affiliate_tag_only' is its own
 * category. Amazon was categorized 'affiliate_feed', but there is
 * no feed: only an affiliate tag that stamps outbound links. A
 * tag-only adapter must never be ranked or described as a feed.
 */
export type ProviderCategory =
  | 'official_api'
  | 'affiliate_feed'
  | 'affiliate_tag_only'
  | 'merchant_upload'
  | 'csv_import'
  | 'scraping'
  | 'mock';

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
  /**
   * Section 21–25, Stage C (B1) — specs the feed carries for this
   * product (key/value/unit). Unknown values stay unknown: a key
   * the feed does not carry is simply absent, never guessed. The
   * pipeline validates each entry against the category template
   * and writes it with per-spec attribution.
   */
  specs?: Array<{ key: string; value: string; unit?: string }>;
  /**
   * Section 21–25, Stage C (B4) — variants the feed carries for
   * this product. No provider supplies variants today, so this is
   * normally absent; when present the pipeline creates/updates
   * product_variants rows (SKU → GTIN → attributes matching).
   */
  variants?: Array<{
    name: string;
    attributes?: Record<string, string>;
    sku?: string;
    gtin?: string;
    imageUrl?: string;
    inStock?: boolean;
    sortOrder?: number;
  }>;
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
  /**
   * Sections 21–25, Stage B (B2) — plain-language reason the
   * provider cannot fetch prices today. Returns null when the
   * provider IS available (nothing to explain). Was dead code on
   * the two stubs that had it; it is now part of the interface so
   * every provider answers it, and the admin provider-health
   * surface renders it.
   */
  getNotConfiguredReason(): string | null;
  search(request: ProviderSearchRequest): Promise<RawProductData[]>;
  fetch(request: ProviderFetchRequest): Promise<RawProductData | null>;
}
