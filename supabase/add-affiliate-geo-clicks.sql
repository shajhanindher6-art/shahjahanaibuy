-- =====================================================================
-- SmartBuy AI — Geo affiliate click log (Phase 3 Prep)
-- OWNER STEP: run once in the Supabase SQL Editor (Ctrl+A, then Run).
-- Until this runs, the geo-click beacon answers success but stores
-- nothing (fail-open by design); it never breaks navigation.
-- =====================================================================
-- WHY A SEPARATE TABLE (not affiliate_clicks): the older table
-- (migration 009) requires affiliate_link_id NOT NULL (a link row
-- must exist first) and migration 015 restricts its INSERT to
-- authenticated users — so it cannot log anonymous, link-less geo
-- clicks at all. This table logs exactly the geo engine's shape and
-- leaves the older analytics untouched.
--
-- PRIVACY, BY DESIGN: no ip_address, no user_agent, no user_id.
-- Only the geo country (Vercel header or saved region cookie, null
-- when unknown), the product, the retailer name, and the clicked
-- merchant URL. No anon INSERT policy is created on purpose:
-- inserts go through the service-role client in the beacon route,
-- so a public INSERT policy (a spam vector) is never needed.
-- =====================================================================

CREATE TABLE IF NOT EXISTS affiliate_geo_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  product_slug text,
  retailer_name text,
  target_url text NOT NULL,
  country_code char(2),
  clicked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_affiliate_geo_clicks_clicked_at
  ON affiliate_geo_clicks (clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_affiliate_geo_clicks_product_slug
  ON affiliate_geo_clicks (product_slug);
CREATE INDEX IF NOT EXISTS idx_affiliate_geo_clicks_country
  ON affiliate_geo_clicks (country_code);

-- Verify (the SQL editor shows only this last result):
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'affiliate_geo_clicks'
ORDER BY ordinal_position;
