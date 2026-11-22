/**
 * Price comparison over merchant_offers.
 *
 * Given a product identity — a GTIN, or an MPN + brand — this
 * queries every PUBLIC, IN-STOCK offer across networks (CJ +
 * Amazon) and returns them cheapest-first with the exact saving
 * against the most expensive offer. It never invents a price:
 * with no matching live offers it returns an empty list and
 * null lowest/highest prices.
 *
 * COMPLIANCE: the query only ever reads rows where
 * is_public_live = true AND availability = 'in_stock'. Rows
 * imported before the CJ PSA display rules are verified stay
 * is_public_live = false and are invisible here by construction.
 *
 * The Supabase client is injected so unit tests can pass a mock;
 * the default is the server-only service-role client
 * (lib/supabase/service.ts). The filters are explicit in the
 * query, so even the service role cannot leak non-live rows.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { validateGtin } from '@/lib/gtin';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import type {
  ComparedOffer,
  MerchantOfferRow,
  PriceComparison,
} from '@/lib/offers/types';

export interface ComparePricesInput {
  /** GTIN (UPC/EAN/ISBN — digits, separators allowed). */
  gtin?: string | null;
  /** Manufacturer part number — only used with `brand`. */
  mpn?: string | null;
  /** Brand, as stored in the feed — only used with `mpn`. */
  brand?: string | null;
}

const OFFER_COLUMNS =
  'network,advertiser_id,advertiser_name,external_product_id,gtin,mpn,brand,title,image_url,affiliate_url,price,sale_price,currency,availability';

/** Effective price the shopper pays: sale price when set, else list. */
export function effectivePriceOf(offer: {
  price: number;
  sale_price: number | null;
}): number {
  return offer.sale_price !== null && offer.sale_price > 0
    ? offer.sale_price
    : offer.price;
}

/** Round money to cents so float dust never reaches the UI. */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function toComparedOffer(row: MerchantOfferRow): ComparedOffer {
  return {
    network: row.network,
    advertiser_id: row.advertiser_id,
    advertiser_name: row.advertiser_name,
    external_product_id: row.external_product_id,
    gtin: row.gtin,
    mpn: row.mpn,
    brand: row.brand,
    title: row.title,
    image_url: row.image_url,
    affiliate_url: row.affiliate_url,
    effective_price: roundMoney(effectivePriceOf(row)),
    price: row.price,
    sale_price: row.sale_price,
    currency: row.currency,
    availability: row.availability,
  };
}

function emptyComparison(
  gtin: string | null,
  mpn: string | null,
  brand: string | null,
): PriceComparison {
  return {
    gtin,
    mpn,
    brand,
    offers: [],
    lowest_price: null,
    highest_price: null,
    savings: 0,
    currency: null,
  };
}

/**
 * Compare live offers for one product. GTIN wins when it is
 * GS1-valid; otherwise MPN + brand is used. With neither
 * identity available, returns an empty comparison (no error —
 * the product simply has no comparable offers yet).
 *
 * CURRENCY: offers may arrive in several currencies (CJ + Amazon
 * feeds). A saving across currencies is meaningless, so the
 * comparison covers only the LARGEST currency group (ties: the
 * group with the lowest effective price). Single-currency input
 * is unaffected — the group is the whole list. The returned
 * offers, lowest/highest prices and savings are all in the one
 * reported currency.
 *
 * @throws when the Supabase client is not configured or the
 * query itself fails.
 */
export async function comparePrices(
  input: ComparePricesInput,
  client?: SupabaseClient,
): Promise<PriceComparison> {
  const supabase = client ?? createSupabaseServiceClient();
  if (!supabase) {
    throw new Error(
      'Supabase service client is not configured (SUPABASE_SERVICE_ROLE_KEY is missing)',
    );
  }

  const gtinResult =
    input.gtin != null && input.gtin.trim() !== ''
      ? validateGtin(input.gtin)
      : null;
  const gtin = gtinResult?.valid ? gtinResult.normalized : null;
  const mpn =
    gtin === null && input.mpn != null && input.mpn.trim() !== ''
      ? input.mpn.trim()
      : null;
  const brand =
    mpn !== null && input.brand != null && input.brand.trim() !== ''
      ? input.brand.trim()
      : null;

  if (gtin === null && (mpn === null || brand === null)) {
    return emptyComparison(null, mpn, brand);
  }

  let query = supabase
    .from('merchant_offers')
    .select(OFFER_COLUMNS)
    .eq('is_public_live', true)
    .eq('availability', 'in_stock');

  if (gtin !== null) {
    query = query.eq('gtin', gtin);
  } else {
    query = query.eq('mpn', mpn as string).eq('brand', brand as string);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`merchant_offers query failed: ${error.message}`);
  }

  const rows = (data ?? []) as MerchantOfferRow[];
  const offers = rows.map(toComparedOffer).sort((a, b) => a.effective_price - b.effective_price);

  if (offers.length === 0) {
    return emptyComparison(gtin, mpn, brand);
  }

  // One currency group only: the largest group wins (ties: the
  // group with the lowest effective price). Groups preserve the
  // cheapest-first order because `offers` is already sorted.
  const byCurrency = new Map<string, ComparedOffer[]>();
  for (const offer of offers) {
    const group = byCurrency.get(offer.currency) ?? [];
    group.push(offer);
    byCurrency.set(offer.currency, group);
  }
  let grouped: ComparedOffer[] | null = null;
  for (const candidate of byCurrency.values()) {
    if (
      grouped === null ||
      candidate.length > grouped.length ||
      (candidate.length === grouped.length &&
        candidate[0].effective_price < grouped[0].effective_price)
    ) {
      grouped = candidate;
    }
  }
  const compared = grouped ?? [];

  const lowest = compared[0].effective_price;
  const highest = compared[compared.length - 1].effective_price;
  return {
    gtin,
    mpn,
    brand,
    offers: compared,
    lowest_price: lowest,
    highest_price: highest,
    savings: roundMoney(compared.length > 1 ? highest - lowest : 0),
    currency: compared[0].currency,
  };
}
