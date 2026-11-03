-- Universal cross-store wishlist items (Option 8, Feature 5).
-- OWNER: run once in the Supabase SQL editor. Until this runs, the
-- add-by-URL form reports that external items are not enabled yet
-- (never a crash, never a fake sync).
--
-- HONESTY: external items NEVER claim price tracking. They are labeled
-- "External item — price tracking unavailable" unless the user explicitly
-- links a catalog product (by slug, validated server-side). A catalog
-- match is never applied automatically. Existing wishlist_items RLS policies
-- (own-wishlist checks) continue to govern these rows unchanged.

DO $$
BEGIN
  -- Allow items without a catalog product (external items).
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'wishlist_items' AND column_name = 'product_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE wishlist_items ALTER COLUMN product_id DROP NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'wishlist_items' AND column_name = 'external_title'
  ) THEN
    ALTER TABLE wishlist_items ADD COLUMN external_title text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'wishlist_items' AND column_name = 'external_store'
  ) THEN
    ALTER TABLE wishlist_items ADD COLUMN external_store text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'wishlist_items' AND column_name = 'external_url'
  ) THEN
    ALTER TABLE wishlist_items ADD COLUMN external_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'wishlist_items' AND column_name = 'external_price'
  ) THEN
    ALTER TABLE wishlist_items ADD COLUMN external_price numeric(12, 2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'wishlist_items' AND column_name = 'external_currency'
  ) THEN
    ALTER TABLE wishlist_items ADD COLUMN external_currency text;
  END IF;
END $$;
