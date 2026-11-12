-- SmartBuy AI — seed the 10 public catalog products (Section 15, A10)
-- =====================================================================
-- PURPOSE
--   Recreate the 10 products of the live public catalog in a fresh
--   environment. The repo could not do this before: there was no
--   `INSERT INTO products` anywhere in `supabase/` or `scripts/`, so a
--   fresh database had no catalog at all.
--
-- SOURCE OF TRUTH (nothing invented)
--   Every row below is copied verbatim from the live API
--   `GET https://shahjahanaibuy-b1zp.vercel.app/api/v1/products`
--   fetched 2026-11-12 (HTTP 200, total 10). `id`, `name`, `slug`,
--   `description`, `brand`, `category`, `confidence_score` (50 on all
--   rows), `data_freshness`, `created_at`, `updated_at` are the exact
--   live values. `image_url` and `gtin` are NULL on all 10 rows live,
--   so they are NULL here too — do not "fill in" a guessed image or
--   GTIN.
--
--   The `sample-laptop` row is INTENTIONALLY ABSENT. It is a database
--   health-check row excluded from every public surface; it is not
--   part of the public catalog and must not be re-created here.
--
-- PRICES ARE NOT IN THIS FILE
--   Prices live in `merchant_products` (per merchant), not in
--   `products`. See `supabase/seed-demo-data.sql` for the merchant /
--   price / price-history / deals seed, which looks products up by
--   slug — run this file BEFORE that one in a fresh environment.
--
-- HOW TO RUN (owner applies it ONCE — this file is NOT run
-- automatically by any migration, script, or deploy step):
--   Supabase Dashboard -> your project -> SQL Editor -> New query ->
--   paste this whole file -> Run. No keys or secrets are needed.
--
-- IDEMPOTENT
--   `ON CONFLICT (id) DO NOTHING`: re-running this file inserts
--   nothing new and changes nothing. It never overwrites a row.
-- =====================================================================

INSERT INTO products
  (id, name, slug, description, brand, category, image_url, gtin,
   confidence_score, data_freshness, created_at, updated_at)
VALUES
  ('87949d47-42c3-4c3f-b9b6-f2f746d1ed33', 'Galaxy S24 Ultra', 'galaxy-s24-ultra',
   'Samsung Galaxy S24 Ultra smartphone.', 'Samsung', 'Smartphones',
   NULL, NULL, 50,
   '2026-11-02T07:13:52.124833+00:00',
   '2026-11-02T07:13:52.124833+00:00',
   '2026-11-02T07:13:52.124833+00:00'),
  ('551bd8a1-4bd3-4da6-9a3d-777c97019227', 'Sony WH-1000XM5', 'sony-wh-1000xm5',
   'Sony WH-1000XM5 noise cancelling headphones.', 'Sony', 'Headphones',
   NULL, NULL, 50,
   '2026-11-02T07:13:52.124833+00:00',
   '2026-11-02T07:13:52.124833+00:00',
   '2026-11-02T07:13:52.124833+00:00'),
  ('efd4bfac-44f8-40bb-823c-e047fcce0040', 'Dell XPS 13', 'dell-xps-13',
   'Dell XPS 13 laptop.', 'Dell', 'Laptops',
   NULL, NULL, 50,
   '2026-11-02T07:13:52.124833+00:00',
   '2026-11-02T07:13:52.124833+00:00',
   '2026-11-02T07:13:52.124833+00:00'),
  ('05ee9212-025a-4fa7-b971-dee922031bc3', 'Lenovo ThinkPad X1', 'lenovo-thinkpad-x1',
   'Lenovo ThinkPad X1 laptop.', 'Lenovo', 'Laptops',
   NULL, NULL, 50,
   '2026-11-02T07:13:52.124833+00:00',
   '2026-11-02T07:13:52.124833+00:00',
   '2026-11-02T07:13:52.124833+00:00'),
  ('38252dd6-0a88-4b66-87a4-20e11b1c75f2', 'Bose QuietComfort Ultra', 'bose-quietcomfort-ultra',
   'Bose QuietComfort Ultra headphones.', 'Bose', 'Headphones',
   NULL, NULL, 50,
   '2026-11-02T07:13:52.124833+00:00',
   '2026-11-02T07:13:52.124833+00:00',
   '2026-11-02T07:13:52.124833+00:00'),
  ('17550c2e-784f-4630-9480-91b81771e62d', 'Canon EOS R10', 'canon-eos-r10',
   'Canon EOS R10 mirrorless camera.', 'Canon', 'Cameras',
   NULL, NULL, 50,
   '2026-11-02T07:13:52.124833+00:00',
   '2026-11-02T07:13:52.124833+00:00',
   '2026-11-02T07:13:52.124833+00:00'),
  ('fa7af3f2-c656-48cf-a9f9-a639189f0a07', 'GoPro Hero12', 'gopro-hero12',
   'GoPro Hero12 action camera.', 'GoPro', 'Cameras',
   NULL, NULL, 50,
   '2026-11-02T07:13:52.124833+00:00',
   '2026-11-02T07:13:52.124833+00:00',
   '2026-11-02T07:13:52.124833+00:00'),
  ('0338b8d2-0db1-4d37-9931-55c573553f10', 'Garmin Venu 3', 'garmin-venu-3',
   'Garmin Venu 3 smartwatch.', 'Garmin', 'Smartwatches',
   NULL, NULL, 50,
   '2026-11-02T07:13:52.124833+00:00',
   '2026-11-02T07:13:52.124833+00:00',
   '2026-11-02T07:13:52.124833+00:00'),
  ('db38255f-5067-4f16-a694-41da3e3a2e91', 'Logitech MX Master 3S', 'logitech-mx-master-3s',
   'Logitech MX Master 3S wireless mouse.', 'Logitech', 'Accessories',
   NULL, NULL, 50,
   '2026-11-02T07:13:52.124833+00:00',
   '2026-11-02T07:13:52.124833+00:00',
   '2026-11-02T07:13:52.124833+00:00'),
  ('3aa8470f-7bcd-448d-bd09-bd1ce13c31f6', 'MacBook Air 13', 'macbook-air-13',
   'Apple MacBook Air 13-inch laptop.', 'Apple', 'Laptops',
   NULL, NULL, 50,
   '2026-11-02T07:13:52.124833+00:00',
   '2026-11-02T07:13:52.124833+00:00',
   '2026-11-02T07:13:52.124833+00:00')
ON CONFLICT (id) DO NOTHING;

-- Verify: expect exactly 10 rows, no sample-laptop.
--   SELECT count(*) FROM products;                       -- 10
--   SELECT slug FROM products WHERE slug = 'sample-laptop'; -- 0 rows
