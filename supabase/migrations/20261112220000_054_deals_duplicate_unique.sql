-- 054 — Duplicate-deal guard: UNIQUE index on the deals table
-- (Section 19, Phase 2; audit §12 #58/#66, §1 #16).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor). Until it is applied, the code dedupe in
-- services/deal-validation.ts (dedupeByKey, called from
-- services/ai-deals.ts) already collapses identical deals at read
-- time, so the fix works before this index exists. Nothing 500s
-- because this file is unapplied.
--
--   * The deals table has no UNIQUE on (product, merchant,
--     discount, window) — only its PK (migration 005). Two
--     identical active deals rank as two separate rows.
--   * This partial UNIQUE index constrains exactly the deal
--     identity the code dedupe uses: product_id + merchant_id +
--     discount_type + discount_value + start_at + end_at, over
--     non-deleted rows only (deleted_at IS NULL), so a
--     soft-deleted deal never blocks a live re-creation.
--   * merchant_id is NULLABLE, and Postgres treats NULLs as
--     distinct in a unique index — two merchant-less identical
--     deals would NOT conflict. The COALESCE to the nil UUID
--     makes them conflict, matching the code dedupe (which keys
--     a null merchant as the empty string).
--
-- PRE-CONDITION — verify before applying (the CREATE will fail
-- if duplicates already exist; the failure is safe, it changes
-- nothing):
--   SELECT product_id, merchant_id, discount_type, discount_value,
--          start_at, end_at, count(*)
--     FROM deals
--    WHERE deleted_at IS NULL
--    GROUP BY 1,2,3,4,5,6 HAVING count(*) > 1;
-- If that returns rows, delete (or soft-delete) the extras first,
-- keeping the earliest created row of each identical set.
-- The code dedupe already hides duplicates from ranking, so the
-- only effect of applying is to prevent FUTURE duplicates at
-- insert time (a duplicate insert then fails with 23505, which
-- callers must handle as "already exists", not as a crash).

CREATE UNIQUE INDEX IF NOT EXISTS deals_identity_unique_idx
  ON deals (
    product_id,
    COALESCE(merchant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    discount_type,
    discount_value,
    start_at,
    end_at
  )
  WHERE deleted_at IS NULL;

COMMENT ON INDEX deals_identity_unique_idx IS
  'Section 19 Phase 2 (#58/#66): one active deal per product + merchant + discount + window. Partial (live rows only); NULL merchant coalesced to the nil UUID so merchant-less duplicates conflict too. DO NOT APPLY YET — owner step.';
