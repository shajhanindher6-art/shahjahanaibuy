-- Migration 023: Option 20 Support (Clean Global Readiness & Release Signals)
-- All new columns default to NULL ("Not recorded") — no invented data.
--   * regional_availability: recorded per-region availability map
--     (e.g. {"US": true, "PK": false}). NULL = not recorded. Never
--     defaulted to a hardcoded region set.
--   * next_gen_release_months: months until the next generation's
--     recorded release schedule. NULL = no schedule recorded. This is
--     a recorded schedule value, not a forecast — nothing here predicts
--     a release date. CHECK keeps it a non-negative integer.
--   * global_warranty_type: recorded warranty scope (e.g. "Local
--     Manufacturer"). NULL = not recorded. No warranty type is ever
--     assumed — see services/return-policies.ts.

ALTER TABLE products
ADD COLUMN IF NOT EXISTS regional_availability JSONB DEFAULT NULL,
ADD COLUMN IF NOT EXISTS next_gen_release_months INT DEFAULT NULL CHECK (next_gen_release_months >= 0),
ADD COLUMN IF NOT EXISTS global_warranty_type VARCHAR(50) DEFAULT NULL;
