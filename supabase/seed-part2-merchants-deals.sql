-- SmartBuy AI — seed part 2: merchants, deals, coupons, cashback ONLY
-- =====================================================================
-- Run this ONLY if the first seed run filled price_history but NOT
-- merchants/deals/coupons/cashback (the split seen on 2026-10-31).
-- Do NOT re-run the full seed-demo-data.sql — that would duplicate
-- the price_history rows that already succeeded.
-- This file contains the same merchants, merchant_products, deals,
-- coupons and cashback sections as the full seed, with the
-- price_history section removed. Merchants and merchant_products
-- are idempotent (ON CONFLICT); deals/coupons/cashback are not
-- deduplicated, so run this once and check counts afterwards.
-- Prices are DEMO/placeholder, not live retailer prices.
-- =====================================================================

-- 1. Merchants ------------------------------------------------------------
INSERT INTO merchants (name, slug, website_url, status, active)
VALUES
  ('Amazon', 'amazon', 'https://www.amazon.com', 'active', true),
  ('Best Buy', 'best-buy', 'https://www.bestbuy.com', 'active', true)
ON CONFLICT (slug) DO NOTHING;

-- 2. Merchant products --------------------------------------------------
-- Base demo prices: MacBook 999, Galaxy 1199, Sony 399, Dell 1099,
-- Lenovo 1399, Bose 429, Canon 979, GoPro 399, Garmin 449, Logitech 99.
-- Best Buy is priced ~2% above Amazon for comparison purposes.
INSERT INTO merchant_products
  (product_id, merchant_id, price, compare_at_price, availability, in_stock, last_synced_at)
SELECT p.id, m.id,
  CASE p.slug
    WHEN 'macbook-air-13' THEN 999
    WHEN 'galaxy-s24-ultra' THEN 1199
    WHEN 'sony-wh-1000xm5' THEN 399
    WHEN 'dell-xps-13' THEN 1099
    WHEN 'lenovo-thinkpad-x1' THEN 1399
    WHEN 'bose-quietcomfort-ultra' THEN 429
    WHEN 'canon-eos-r10' THEN 979
    WHEN 'gopro-hero12' THEN 399
    WHEN 'garmin-venu-3' THEN 449
    WHEN 'logitech-mx-master-3s' THEN 99
  END,
  CASE p.slug
    WHEN 'macbook-air-13' THEN 1099
    WHEN 'galaxy-s24-ultra' THEN 1299
    WHEN 'sony-wh-1000xm5' THEN 449
    WHEN 'dell-xps-13' THEN 1199
    WHEN 'lenovo-thinkpad-x1' THEN 1499
    WHEN 'bose-quietcomfort-ultra' THEN 479
    WHEN 'canon-eos-r10' THEN 1079
    WHEN 'gopro-hero12' THEN 449
    WHEN 'garmin-venu-3' THEN 499
    WHEN 'logitech-mx-master-3s' THEN 119
  END,
  'in_stock', true, now()
FROM products p
CROSS JOIN merchants m
WHERE m.slug = 'amazon'
  AND p.slug IN ('macbook-air-13','galaxy-s24-ultra','sony-wh-1000xm5','dell-xps-13',
                 'lenovo-thinkpad-x1','bose-quietcomfort-ultra','canon-eos-r10',
                 'gopro-hero12','garmin-venu-3','logitech-mx-master-3s')
ON CONFLICT (merchant_id, product_id) DO UPDATE
  SET price = EXCLUDED.price,
      compare_at_price = EXCLUDED.compare_at_price,
      availability = 'in_stock', in_stock = true, last_synced_at = now();

INSERT INTO merchant_products
  (product_id, merchant_id, price, compare_at_price, availability, in_stock, last_synced_at)
SELECT p.id, m.id,
  ROUND(CASE p.slug
    WHEN 'macbook-air-13' THEN 999
    WHEN 'galaxy-s24-ultra' THEN 1199
    WHEN 'sony-wh-1000xm5' THEN 399
    WHEN 'dell-xps-13' THEN 1099
    WHEN 'lenovo-thinkpad-x1' THEN 1399
    WHEN 'bose-quietcomfort-ultra' THEN 429
    WHEN 'canon-eos-r10' THEN 979
    WHEN 'gopro-hero12' THEN 399
    WHEN 'garmin-venu-3' THEN 449
    WHEN 'logitech-mx-master-3s' THEN 99
  END * 1.02, 2),
  CASE p.slug
    WHEN 'macbook-air-13' THEN 1099
    WHEN 'galaxy-s24-ultra' THEN 1299
    WHEN 'sony-wh-1000xm5' THEN 449
    WHEN 'dell-xps-13' THEN 1199
    WHEN 'lenovo-thinkpad-x1' THEN 1499
    WHEN 'bose-quietcomfort-ultra' THEN 479
    WHEN 'canon-eos-r10' THEN 1079
    WHEN 'gopro-hero12' THEN 449
    WHEN 'garmin-venu-3' THEN 499
    WHEN 'logitech-mx-master-3s' THEN 119
  END,
  'in_stock', true, now()
FROM products p
CROSS JOIN merchants m
WHERE m.slug = 'best-buy'
  AND p.slug IN ('macbook-air-13','galaxy-s24-ultra','sony-wh-1000xm5','dell-xps-13',
                 'lenovo-thinkpad-x1','bose-quietcomfort-ultra','canon-eos-r10',
                 'gopro-hero12','garmin-venu-3','logitech-mx-master-3s')
ON CONFLICT (merchant_id, product_id) DO UPDATE
  SET price = EXCLUDED.price,
      compare_at_price = EXCLUDED.compare_at_price,
      availability = 'in_stock', in_stock = true, last_synced_at = now();

-- 4. Deals (active, end in 30 days) ------------------------------------
INSERT INTO deals
  (product_id, merchant_id, title, description, deal_type, discount_type, discount_value, start_at, end_at, active)
SELECT p.id, m.id, d.title, d.description, d.deal_type, 'percentage', d.discount_value,
       now() - interval '7 days', now() + interval '30 days', true
FROM (
  VALUES
    ('macbook-air-13', 'MacBook Air 13 — 10% off', 'Demo launch deal on the MacBook Air 13.', 'seasonal', 10),
    ('dell-xps-13', 'Dell XPS 13 — 15% off', 'Demo launch deal on the Dell XPS 13.', 'seasonal', 15),
    ('sony-wh-1000xm5', 'Sony WH-1000XM5 — 20% off', 'Demo launch deal on the Sony headphones.', 'flash', 20),
    ('galaxy-s24-ultra', 'Galaxy S24 Ultra — 12% off', 'Demo launch deal on the Galaxy S24 Ultra.', 'seasonal', 12),
    ('canon-eos-r10', 'Canon EOS R10 — 10% off', 'Demo launch deal on the Canon EOS R10.', 'seasonal', 10),
    ('bose-quietcomfort-ultra', 'Bose QuietComfort Ultra — 15% off', 'Demo launch deal on the Bose headphones.', 'flash', 15)
) AS d(slug, title, description, deal_type, discount_value)
JOIN products p ON p.slug = d.slug
CROSS JOIN merchants m
WHERE m.slug = 'amazon';

-- 5. Coupons (merchant-wide; the coupons API shows these on all products)
INSERT INTO coupons (code, merchant_id, description, discount_type, discount_value, valid_until, active)
SELECT 'SAVE10', m.id, 'Demo coupon: 10% off at Amazon.', 'percentage', 10, now() + interval '90 days', true
FROM merchants m WHERE m.slug = 'amazon'
ON CONFLICT (code) DO NOTHING;

INSERT INTO coupons (code, merchant_id, description, discount_type, discount_value, valid_until, active)
SELECT 'BESTBUY15', m.id, 'Demo coupon: $15 off at Best Buy.', 'fixed', 15, now() + interval '90 days', true
FROM merchants m WHERE m.slug = 'best-buy'
ON CONFLICT (code) DO NOTHING;

-- 6. Cashback offers (per product, so the Savings tab fills in) --------
INSERT INTO cashback_offers
  (merchant_id, product_id, title, description, cashback_type, cashback_value, end_at, active)
SELECT m.id, p.id, '5% cashback at Amazon', 'Demo cashback offer.', 'percentage', 5,
       now() + interval '90 days', true
FROM products p
CROSS JOIN merchants m
WHERE m.slug = 'amazon'
  AND p.slug IN ('macbook-air-13','galaxy-s24-ultra','sony-wh-1000xm5','dell-xps-13',
                 'lenovo-thinkpad-x1','bose-quietcomfort-ultra','canon-eos-r10',
                 'gopro-hero12','garmin-venu-3','logitech-mx-master-3s');

-- 7. Verify counts (run these after the inserts) -----------------------
-- SELECT 'merchants', count(*) FROM merchants;
-- SELECT 'retailers', count(*) FROM retailers;
-- SELECT 'merchant_products', count(*) FROM merchant_products;
-- SELECT 'price_history', count(*) FROM price_history;
-- SELECT 'deals (active)', count(*) FROM deals WHERE active = true AND end_at > now();
-- SELECT 'coupons', count(*) FROM coupons WHERE active = true;
-- SELECT 'cashback_offers', count(*) FROM cashback_offers WHERE active = true;
