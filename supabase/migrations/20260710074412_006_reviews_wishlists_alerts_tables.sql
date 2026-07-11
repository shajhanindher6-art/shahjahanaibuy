/*
# SmartBuy AI — Reviews, Wishlists & Alerts Tables (Phase 2 Upgrade, Migration 4)

## Overview
Creates the social and user-engagement layer: review_sources, reviews,
wishlists, wishlist_items, and alerts. These tables support user-generated
content (reviews), product saving (wishlists), and price tracking notifications (alerts).

## 1. New Tables

### `review_sources`
- Platforms from which reviews are collected (Amazon, Trustpilot, internal, etc.)
- `id` (uuid PK), `name`, `slug` (unique), `website_url`, `logo_url`
- `trust_score` (0-100), `active`, `created_at`, `updated_at`
- Pre-seeded with Amazon, eBay, Trustpilot, Internal

### `reviews`
- Product reviews from various sources (external + user-submitted)
- `id` (uuid PK), `product_id` (FK), `review_source_id` (FK, nullable)
- `user_id` (FK to profiles, nullable — for internal user reviews)
- `author_name`, `rating` (1-5), `title`, `content`
- `verified_purchase`, `helpful_count`, `source_url`
- `language_id` (FK, nullable), `created_at`, `updated_at`, `deleted_at`
- Indexed on `(product_id, created_at DESC)`, `rating`

### `wishlists`
- User product wishlists (multiple lists per user)
- `id` (uuid PK), `user_id` (FK to profiles, CASCADE)
- `name`, `description`, `is_public` (boolean), `sort_order`
- `created_at`, `updated_at`
- Indexed on `user_id`

### `wishlist_items`
- Products saved to wishlists
- `id` (uuid PK), `wishlist_id` (FK, CASCADE), `product_id` (FK, CASCADE)
- `notes`, `target_price` (price alert threshold), `sort_order`
- `added_at` (timestamptz)
- UNIQUE on `(wishlist_id, product_id)` — no duplicates in same list
- Indexed on `wishlist_id`, `product_id`

### `alerts`
- User-configured price and availability alerts
- `id` (uuid PK), `user_id` (FK to profiles, CASCADE)
- `product_id` (FK), `alert_type` (price_drop, back_in_stock, deal)
- `condition_value` (e.g., target price for price_drop alerts)
- `channel` (email, push, both), `active`, `last_triggered_at`
- `trigger_count`, `created_at`, `updated_at`
- Indexed on `(user_id, active)`, `(product_id, active)`

## 2. Security (RLS)
- `review_sources`: public read, no client write
- `reviews`: public read, owner-scoped insert/update/delete for user reviews
- `wishlists`: owner-scoped CRUD (authenticated, user_id = auth.uid())
- `wishlist_items`: owner-scoped via wishlist ownership check
- `alerts`: owner-scoped CRUD (authenticated, user_id = auth.uid())

## 3. Triggers
- `update_review_sources_updated_at()`, `update_reviews_updated_at()`
- `update_wishlists_updated_at()`, `update_alerts_updated_at()`

## 4. Important Notes
1. Reviews can come from external sources (review_sources) or internal users (user_id)
2. `reviews.verified_purchase` indicates whether the reviewer actually bought the product
3. Wishlists support multiple named lists per user with public/private visibility
4. `wishlist_items.target_price` enables per-item price drop alerts
5. `alerts` supports multiple alert types: price_drop, back_in_stock, deal
6. `alerts.condition_value` stores the threshold (e.g., target price) for the alert
*/

-- ============================================================================
-- REVIEW_SOURCES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS review_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  website_url text,
  logo_url text,
  trust_score integer NOT NULL DEFAULT 50,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE review_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "review_sources_select_all" ON review_sources;
CREATE POLICY "review_sources_select_all" ON review_sources FOR SELECT
  TO anon, authenticated USING (true);

DROP TRIGGER IF EXISTS update_review_sources_updated_at ON review_sources;
CREATE TRIGGER update_review_sources_updated_at
  BEFORE UPDATE ON review_sources
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- REVIEWS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  review_source_id uuid REFERENCES review_sources(id) ON DELETE SET NULL,
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  author_name text,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  title text,
  content text,
  verified_purchase boolean NOT NULL DEFAULT false,
  helpful_count integer NOT NULL DEFAULT 0,
  source_url text,
  language_id uuid REFERENCES languages(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reviews_select_all" ON reviews;
CREATE POLICY "reviews_select_all" ON reviews FOR SELECT
  TO anon, authenticated USING (deleted_at IS NULL);

-- Users can insert their own reviews
DROP POLICY IF EXISTS "reviews_insert_own" ON reviews;
CREATE POLICY "reviews_insert_own" ON reviews FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

-- Users can update their own reviews
DROP POLICY IF EXISTS "reviews_update_own" ON reviews;
CREATE POLICY "reviews_update_own" ON reviews FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Users can delete (soft-delete) their own reviews
DROP POLICY IF EXISTS "reviews_delete_own" ON reviews;
CREATE POLICY "reviews_delete_own" ON reviews FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS reviews_product_created_idx ON reviews(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reviews_rating_idx ON reviews(rating);

DROP TRIGGER IF EXISTS update_reviews_updated_at ON reviews;
CREATE TRIGGER update_reviews_updated_at
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- WISHLISTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS wishlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  is_public boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE wishlists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wishlists_select_own" ON wishlists;
CREATE POLICY "wishlists_select_own" ON wishlists FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "wishlists_insert_own" ON wishlists;
CREATE POLICY "wishlists_insert_own" ON wishlists FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "wishlists_update_own" ON wishlists;
CREATE POLICY "wishlists_update_own" ON wishlists FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "wishlists_delete_own" ON wishlists;
CREATE POLICY "wishlists_delete_own" ON wishlists FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS wishlists_user_idx ON wishlists(user_id);

DROP TRIGGER IF EXISTS update_wishlists_updated_at ON wishlists;
CREATE TRIGGER update_wishlists_updated_at
  BEFORE UPDATE ON wishlists
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- WISHLIST_ITEMS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS wishlist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wishlist_id uuid NOT NULL REFERENCES wishlists(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  notes text,
  target_price numeric(12, 2),
  sort_order integer NOT NULL DEFAULT 0,
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wishlist_id, product_id)
);

ALTER TABLE wishlist_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wishlist_items_select_own" ON wishlist_items;
CREATE POLICY "wishlist_items_select_own" ON wishlist_items FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM wishlists WHERE wishlists.id = wishlist_items.wishlist_id AND wishlists.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "wishlist_items_insert_own" ON wishlist_items;
CREATE POLICY "wishlist_items_insert_own" ON wishlist_items FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM wishlists WHERE wishlists.id = wishlist_items.wishlist_id AND wishlists.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "wishlist_items_update_own" ON wishlist_items;
CREATE POLICY "wishlist_items_update_own" ON wishlist_items FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM wishlists WHERE wishlists.id = wishlist_items.wishlist_id AND wishlists.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM wishlists WHERE wishlists.id = wishlist_items.wishlist_id AND wishlists.user_id = auth.uid()));

DROP POLICY IF EXISTS "wishlist_items_delete_own" ON wishlist_items;
CREATE POLICY "wishlist_items_delete_own" ON wishlist_items FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM wishlists WHERE wishlists.id = wishlist_items.wishlist_id AND wishlists.user_id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS wishlist_items_wishlist_idx ON wishlist_items(wishlist_id);
CREATE INDEX IF NOT EXISTS wishlist_items_product_idx ON wishlist_items(product_id);

-- ============================================================================
-- ALERTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  alert_type text NOT NULL DEFAULT 'price_drop',
  condition_value numeric(12, 2),
  channel text NOT NULL DEFAULT 'email',
  active boolean NOT NULL DEFAULT true,
  last_triggered_at timestamptz,
  trigger_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "alerts_select_own" ON alerts;
CREATE POLICY "alerts_select_own" ON alerts FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "alerts_insert_own" ON alerts;
CREATE POLICY "alerts_insert_own" ON alerts FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "alerts_update_own" ON alerts;
CREATE POLICY "alerts_update_own" ON alerts FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "alerts_delete_own" ON alerts;
CREATE POLICY "alerts_delete_own" ON alerts FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS alerts_user_active_idx ON alerts(user_id, active);
CREATE INDEX IF NOT EXISTS alerts_product_active_idx ON alerts(product_id, active);

DROP TRIGGER IF EXISTS update_alerts_updated_at ON alerts;
CREATE TRIGGER update_alerts_updated_at
  BEFORE UPDATE ON alerts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- SEED DATA
-- ============================================================================

INSERT INTO review_sources (name, slug, website_url, trust_score) VALUES
  ('Amazon', 'amazon-reviews', 'https://www.amazon.com', 75),
  ('eBay', 'ebay-reviews', 'https://www.ebay.com', 60),
  ('Trustpilot', 'trustpilot', 'https://www.trustpilot.com', 80),
  ('Internal', 'internal', NULL, 90)
ON CONFLICT (slug) DO NOTHING;
