-- 058 — per-spec source attribution (Section 20, §12 #29).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor). Until it is applied, the writer in
-- services/product-attributes.ts retries inserts without these
-- columns on Postgres 42703, so spec writes never fail over an
-- unapplied migration — rows land unattributed, as today.
--
--   * `source` — where this spec value came from, e.g.
--     'manual-intake', 'ebay-browse-api', 'merchant-feed', or a
--     manufacturer / retailer name. Free text, deliberately NO
--     CHECK constraint: unknown values are allowed, and a future
--     source must not need a migration to be named. NULL means
--     unattributed; the explicit value 'unknown' means the
--     provenance was recorded as not known.
--   * `verified_at` — when the value was verified against its
--     source. NULL means never verified. Writers set it only for
--     a named (non-'unknown') source; an unknown-provenance spec
--     is never stamped verified.
--   * `verified_by` — who verified it: an admin user id / email,
--     or 'system'. Free text, NULL means nobody recorded.
--
-- Attribution lives per spec, not per product: one product can
-- carry a manufacturer-stated RAM figure and an admin-typed
-- battery figure, and the two must not share one provenance.
-- Product-level provenance still lives in `product_sources`
-- (migration 002); this table answers the narrower question,
-- "where did THIS value come from", which product_sources
-- cannot. No backfill is possible or attempted: the catalog has
-- 0 product_attributes rows live (audit §2), so there is
-- nothing to attribute retroactively — and inventing a source
-- for a row that has none would be fabrication.

ALTER TABLE product_attributes
  ADD COLUMN IF NOT EXISTS source text;

ALTER TABLE product_attributes
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

ALTER TABLE product_attributes
  ADD COLUMN IF NOT EXISTS verified_by text;

CREATE INDEX IF NOT EXISTS product_attributes_source_idx
  ON product_attributes (source)
  WHERE source IS NOT NULL;

COMMENT ON COLUMN product_attributes.source IS
  'Section 20 (#29): per-spec provenance (free text; unknown values allowed; NULL = unattributed, ''unknown'' = provenance not recorded). DO NOT APPLY YET — owner step.';
COMMENT ON COLUMN product_attributes.verified_at IS
  'Section 20 (#29): when this spec value was verified against its source. NULL = never verified. DO NOT APPLY YET — owner step.';
COMMENT ON COLUMN product_attributes.verified_by IS
  'Section 20 (#29): who verified this spec value (admin id/email or ''system''). NULL = nobody recorded. DO NOT APPLY YET — owner step.';
