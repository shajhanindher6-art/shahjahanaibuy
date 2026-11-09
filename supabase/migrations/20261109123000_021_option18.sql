-- Migration 021: Option 18 Support (Item Weight & Power Draw)
-- Trimmed design: only the genuinely missing physical attributes.
-- Reuses existing infrastructure — NO duplicate tables:
--   * Price alerts: existing `alerts` table (migration 006) + 6h cron chain
--   * Lowest 90-day price: derived from price_history (no stored column)
--   * Duty: existing duty-optimizer / tax-estimator (country/category-based)
-- All columns NULL by default — products without recorded values show an
-- honest "Not recorded yet" state instead of fake data.

ALTER TABLE products
ADD COLUMN IF NOT EXISTS item_weight_kg NUMERIC(5,2) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS power_draw_watts INT DEFAULT NULL;
