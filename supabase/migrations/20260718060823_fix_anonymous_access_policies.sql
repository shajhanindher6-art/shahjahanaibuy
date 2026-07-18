
/*
# Remove Anonymous Access from RLS Policies

## Summary
All SELECT policies on public-facing catalog tables were previously granting access
to both the `anon` and `authenticated` roles. This migration restricts each policy
to `authenticated` users only, resolving Supabase security advisor lint 0012
(auth_allow_anonymous_sign_ins) on all affected tables.

## Affected Tables
- ai_predictions
- ai_summaries
- cashback_offers
- coupons
- deal_rankings
- deals
- price_history
- product_attributes
- product_images
- product_variants
- products
- retailers
- reviews

## Security Changes
Each policy is dropped and recreated scoped to `TO authenticated` only,
removing the `anon` role that was triggering the anonymous-access advisory.
*/

-- ai_predictions
DROP POLICY IF EXISTS "read_ai_predictions" ON ai_predictions;
CREATE POLICY "read_ai_predictions" ON ai_predictions FOR SELECT
  TO authenticated
  USING ((expires_at IS NULL) OR (expires_at > now()));

-- ai_summaries
DROP POLICY IF EXISTS "read_ai_summaries" ON ai_summaries;
CREATE POLICY "read_ai_summaries" ON ai_summaries FOR SELECT
  TO authenticated
  USING ((expires_at IS NULL) OR (expires_at > now()));

-- cashback_offers
DROP POLICY IF EXISTS "read_cashback_offers" ON cashback_offers;
CREATE POLICY "read_cashback_offers" ON cashback_offers FOR SELECT
  TO authenticated
  USING ((active = true) AND (deleted_at IS NULL));

-- coupons
DROP POLICY IF EXISTS "read_coupons" ON coupons;
CREATE POLICY "read_coupons" ON coupons FOR SELECT
  TO authenticated
  USING (active = true);

-- deal_rankings
DROP POLICY IF EXISTS "read_deal_rankings" ON deal_rankings;
CREATE POLICY "read_deal_rankings" ON deal_rankings FOR SELECT
  TO authenticated
  USING (id IS NOT NULL);

-- deals
DROP POLICY IF EXISTS "read_deals" ON deals;
CREATE POLICY "read_deals" ON deals FOR SELECT
  TO authenticated
  USING ((active = true) AND (deleted_at IS NULL));

-- price_history
DROP POLICY IF EXISTS "read_price_history" ON price_history;
CREATE POLICY "read_price_history" ON price_history FOR SELECT
  TO authenticated
  USING (id IS NOT NULL);

-- product_attributes
DROP POLICY IF EXISTS "read_product_attributes" ON product_attributes;
CREATE POLICY "read_product_attributes" ON product_attributes FOR SELECT
  TO authenticated
  USING (id IS NOT NULL);

-- product_images
DROP POLICY IF EXISTS "read_product_images" ON product_images;
CREATE POLICY "read_product_images" ON product_images FOR SELECT
  TO authenticated
  USING (id IS NOT NULL);

-- product_variants
DROP POLICY IF EXISTS "read_product_variants" ON product_variants;
CREATE POLICY "read_product_variants" ON product_variants FOR SELECT
  TO authenticated
  USING ((active = true) AND (deleted_at IS NULL));

-- products
DROP POLICY IF EXISTS "read_products" ON products;
CREATE POLICY "read_products" ON products FOR SELECT
  TO authenticated
  USING (deleted_at IS NULL);

-- retailers
DROP POLICY IF EXISTS "read_retailers" ON retailers;
CREATE POLICY "read_retailers" ON retailers FOR SELECT
  TO authenticated
  USING (active = true);

-- reviews
DROP POLICY IF EXISTS "reviews_select_all" ON reviews;
CREATE POLICY "reviews_select_all" ON reviews FOR SELECT
  TO authenticated
  USING (deleted_at IS NULL);
