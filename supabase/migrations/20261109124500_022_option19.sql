-- Migration 022: Option 19 Support (Recorded Resale Rate & Mandatory Accessories)
-- Override-first design: these are RECORDED per-product attributes that
-- OVERRIDE the existing derived engines — they do NOT recreate them:
--   * annual_depreciation_rate overrides the resale predictor's derived
--     monthly decline (services/resale-predictor.ts) when recorded;
--     otherwise the predictor keeps deriving from price_history.
--   * mandatory_accessories_cost is a separate recorded line in the
--     total-ownership total (services/total-ownership.ts); the
--     shopper's own accessories estimate stays user-entered.
-- All columns NULL by default — products without recorded values show
-- an honest "Data accumulating" state instead of fake defaults.

ALTER TABLE products
ADD COLUMN IF NOT EXISTS annual_depreciation_rate NUMERIC(4,2) DEFAULT NULL CHECK (annual_depreciation_rate >= 0 AND annual_depreciation_rate <= 1),
ADD COLUMN IF NOT EXISTS mandatory_accessories_cost NUMERIC(10,2) DEFAULT NULL;
