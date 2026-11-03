/**
 * Community deals — pure helpers (no I/O, unit-testable).
 *
 * Badge honesty (do not weaken without a new decision):
 * - "Community" = submitted by a signed-in user. Always true for
 *   every row in community_deals (guests cannot submit).
 * - "Verified" is NEVER earned by upvotes. A deal is verified when
 *   EITHER an admin set is_verified, OR the code check passes: the
 *   deal links a catalog product AND a merchant_products row exists
 *   for that merchant + product with a price within 5% of the deal
 *   price. A deal with no product link, no merchant link, or no
 *   price can never be price-verified.
 */

export interface CommunityDealRow {
  id: string;
  user_id: string | null;
  author_name: string | null;
  product_id: string | null;
  product_name: string;
  merchant_id: string | null;
  merchant_name: string | null;
  price: number | null;
  deal_text: string | null;
  coupon_code: string | null;
  source_url: string | null;
  status: string;
  is_verified: boolean;
  created_at: string;
}

export interface MerchantPriceRow {
  merchant_id: string;
  product_id: string;
  price: number;
}

/** Net score = upvotes minus downvotes. */
export function netScore(votes: Array<{ value: number }>): number {
  return votes.reduce((sum, v) => sum + (v.value === 1 ? 1 : v.value === -1 ? -1 : 0), 0);
}

const VERIFY_TOLERANCE = 0.05; // 5%

/**
 * Price-match verification: needs a product link, a merchant link,
 * a deal price, and a merchant_products row for that pair whose
 * price is within 5% of the deal price.
 */
export function isPriceVerified(
  deal: Pick<CommunityDealRow, 'product_id' | 'merchant_id' | 'price'>,
  merchantPrices: MerchantPriceRow[]
): boolean {
  if (!deal.product_id || !deal.merchant_id || deal.price === null) return false;
  return merchantPrices.some((row) => {
    if (row.product_id !== deal.product_id || row.merchant_id !== deal.merchant_id) return false;
    if (row.price <= 0) return false;
    return Math.abs(row.price - deal.price!) / row.price <= VERIFY_TOLERANCE;
  });
}

/** Final verified state: admin flag OR the price-match check. */
export function isDealVerified(
  deal: Pick<CommunityDealRow, 'product_id' | 'merchant_id' | 'price' | 'is_verified'>,
  merchantPrices: MerchantPriceRow[]
): boolean {
  return deal.is_verified === true || isPriceVerified(deal, merchantPrices);
}
