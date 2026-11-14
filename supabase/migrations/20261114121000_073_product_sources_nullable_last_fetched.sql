-- 073 — product_sources.last_fetched_at becomes nullable
-- (Post-Integration Verification & Real Data Phase, 2026-11-14).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor). Until it is applied, link-only rows
-- (services/bestbuy-source-link.ts) retry their upsert with the
-- link time stamped and report `fetchTimestampAssumed: true` —
-- the assumption is named, never silent.
--
-- WHY: `last_fetched_at` was `timestamptz NOT NULL DEFAULT
-- now()` since migration 002. A source LINK is not a fetch: the
-- Best Buy source-linking step creates a `product_sources` row
-- for a product whose SKU was matched but whose price has never
-- been fetched. Stamping "now" on that row would claim a fetch
-- happened at link time, and the attribution surface
-- (services/product-attribution.ts) would show it as the last
-- fetch. NULL means "linked, never fetched" — the honest value —
-- and the price.refresh processor overwrites it with the real
-- fetch time on the first successful fetch (it already updates
-- the column after every fetch).
--
--   * DROP NOT NULL + DROP DEFAULT on
--     `product_sources.last_fetched_at`. Existing rows are
--     untouched (every existing row already carries a real fetch
--     time from ingestion or the processor).
--   * No backfill: a NULL would only be honest for rows that
--     were never fetched, and no such rows exist today — every
--     existing row was written by a fetch path.
--   * Safe to apply at any time: the only reader that types the
--     column (services/product-attribution.ts) already types it
--     `string | null`, and the processor only selects it (it
--     never assumes non-null).

ALTER TABLE product_sources
  ALTER COLUMN last_fetched_at DROP NOT NULL;

ALTER TABLE product_sources
  ALTER COLUMN last_fetched_at DROP DEFAULT;
