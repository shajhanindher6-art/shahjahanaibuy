-- Migration 029: Commerce data — product translations, curated slots,
-- refurbished listings (Sections 3 #15, 5 #13, 5 #18).
--
-- HONESTY RULES (do not weaken them):
-- * Every table starts EMPTY. No seed rows, no demo translations, no
--   fake curator names/bios, no fake refurbished listings. Empty
--   tables render honest empty states until real data is recorded.
-- * product_translations.source is one of 'professional' /
--   'community-verified' / 'auto'. Machine output is ALWAYS 'auto'
--   and the UI must label it "Auto-translated" — never "perfect".
-- * curated_slots records a slot an admin created for a real product
--   in a real region. Curators are people; this table stores no
--   curator identity at all — no names, no bios, nothing to fake.
-- * refurbished_listings stores listings an admin verified against a
--   real source. condition is 'certified-refurbished' or
--   'refurbished' only; price_usd is NULL until a real price is
--   recorded. Zero rows = "No certified refurbished listings yet".
-- * All recorded values are NULL until recorded. Writes are
--   admin-only (public.is_admin() from migration 017); reads are
--   public. Until the owner runs this file, every read below is
--   fail-safe: the code returns nulls/empty lists, never an error.
--
-- Owner step: run this file in Supabase (SQL Editor) after 017/018.

-- 1. Product translations -----------------------------------------------
CREATE TABLE IF NOT EXISTS product_translations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    language_code TEXT NOT NULL CHECK (language_code IN ('en', 'ur', 'de', 'fr', 'es', 'it', 'pt', 'tr')),
    field TEXT NOT NULL CHECK (field IN ('name', 'description')),
    translated_text TEXT NOT NULL CHECK (char_length(translated_text) > 0),
    source TEXT NOT NULL CHECK (source IN ('professional', 'community-verified', 'auto')),
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (product_id, language_code, field)
);

CREATE INDEX IF NOT EXISTS product_translations_product_idx
  ON product_translations (product_id, language_code);

ALTER TABLE product_translations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_translations_select_all ON product_translations;
CREATE POLICY product_translations_select_all ON product_translations
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS insert_product_translations ON product_translations;
CREATE POLICY insert_product_translations ON product_translations
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS update_product_translations ON product_translations;
CREATE POLICY update_product_translations ON product_translations
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS delete_product_translations ON product_translations;
CREATE POLICY delete_product_translations ON product_translations
  FOR DELETE TO authenticated USING (public.is_admin());

-- 2. Curated slots (deal of the day / curated picks) --------------------
CREATE TABLE IF NOT EXISTS curated_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    region_code TEXT NOT NULL CHECK (char_length(region_code) = 2),
    slot_date DATE NOT NULL,
    slot_type TEXT NOT NULL CHECK (slot_type IN ('deal_of_the_day', 'curated_pick')),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    note TEXT CHECK (note IS NULL OR char_length(note) <= 280),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (region_code, slot_date, slot_type)
);

CREATE INDEX IF NOT EXISTS curated_slots_region_date_idx
  ON curated_slots (region_code, slot_date DESC);

ALTER TABLE curated_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS curated_slots_select_all ON curated_slots;
CREATE POLICY curated_slots_select_all ON curated_slots
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS insert_curated_slots ON curated_slots;
CREATE POLICY insert_curated_slots ON curated_slots
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS update_curated_slots ON curated_slots;
CREATE POLICY update_curated_slots ON curated_slots
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS delete_curated_slots ON curated_slots;
CREATE POLICY delete_curated_slots ON curated_slots
  FOR DELETE TO authenticated USING (public.is_admin());

-- 3. Refurbished listings (certified second-hand) -----------------------
CREATE TABLE IF NOT EXISTS refurbished_listings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    merchant_name TEXT NOT NULL CHECK (char_length(merchant_name) > 0),
    condition TEXT NOT NULL CHECK (condition IN ('certified-refurbished', 'refurbished')),
    price_usd NUMERIC CHECK (price_usd IS NULL OR price_usd > 0),
    currency_code TEXT CHECK (currency_code IS NULL OR char_length(currency_code) = 3),
    listing_url TEXT NOT NULL CHECK (char_length(listing_url) > 0),
    source_note TEXT CHECK (source_note IS NULL OR char_length(source_note) <= 280),
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (product_id, merchant_name, listing_url)
);

CREATE INDEX IF NOT EXISTS refurbished_listings_product_idx
  ON refurbished_listings (product_id);

ALTER TABLE refurbished_listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS refurbished_listings_select_all ON refurbished_listings;
CREATE POLICY refurbished_listings_select_all ON refurbished_listings
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS insert_refurbished_listings ON refurbished_listings;
CREATE POLICY insert_refurbished_listings ON refurbished_listings
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS update_refurbished_listings ON refurbished_listings;
CREATE POLICY update_refurbished_listings ON refurbished_listings
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS delete_refurbished_listings ON refurbished_listings;
CREATE POLICY delete_refurbished_listings ON refurbished_listings
  FOR DELETE TO authenticated USING (public.is_admin());

-- Reload the PostgREST schema cache so the new tables apply immediately.
NOTIFY pgrst, 'reload schema';

-- VERIFICATION (last statement: this is what the editor shows).
-- Expect 3 tables, each with 1 SELECT + 3 admin-only write policies,
-- and 0 rows in every table (no seed data by design).
SELECT schemaname, tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('product_translations', 'curated_slots', 'refurbished_listings')
ORDER BY tablename, cmd;
