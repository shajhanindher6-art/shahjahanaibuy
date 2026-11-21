/**
 * CJ Affiliate merchant offers — shared row types.
 *
 * One row per (network, advertiser, product) in the
 * public.merchant_offers table (migration
 * 20261121_cj_affiliate_offers.sql). Rows are written only by the
 * service-role importer (scripts/import-cj-feed.ts); the public
 * site reads only rows where is_public_live = true.
 */

export type OfferAvailability =
  | 'in_stock'
  | 'out_of_stock'
  | 'preorder'
  | 'backorder';

/** A merchant_offers row as upserted by the importer. */
export interface MerchantOfferRow {
  network: string;
  advertiser_id: string;
  advertiser_name: string;
  external_product_id: string;
  gtin: string | null;
  mpn: string | null;
  brand: string | null;
  title: string;
  description: string | null;
  image_url: string | null;
  affiliate_url: string;
  price: number;
  sale_price: number | null;
  currency: string;
  availability: OfferAvailability;
  category: string | null;
  is_public_live: boolean;
  last_synced_at: string;
}

/** One offer as returned to the price-comparison UI. */
export interface ComparedOffer {
  network: string;
  advertiser_id: string;
  advertiser_name: string;
  external_product_id: string;
  gtin: string | null;
  mpn: string | null;
  brand: string | null;
  title: string;
  image_url: string | null;
  affiliate_url: string;
  /** Effective price the shopper pays: sale_price when set, else price. */
  effective_price: number;
  price: number;
  sale_price: number | null;
  currency: string;
  availability: OfferAvailability;
}

/** Price-comparison result for one product identity. */
export interface PriceComparison {
  /** The GTIN that was matched, or null when matched by MPN + brand. */
  gtin: string | null;
  mpn: string | null;
  brand: string | null;
  /** Offers sorted by effective price, cheapest first. */
  offers: ComparedOffer[];
  /** Cheapest effective price, or null when there are no offers. */
  lowest_price: number | null;
  /** Highest effective price, or null when there are no offers. */
  highest_price: number | null;
  /** Exact saving: highest − lowest effective price (0 with < 2 offers). */
  savings: number;
  /** Currency of the offers (all rows share it in practice). */
  currency: string | null;
}
