-- 055 — Product model number (Section 20, Area 1; audit §12 #6).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor). Until it is applied, the code reads the
-- column the same fail-safe way migration 045's columns are read
-- (services/products.ts: the product select asks for model_number
-- and retries without it on Postgres 42703 "column does not
-- exist"), and the intake approve falls back to inserting without
-- the column instead of failing the batch. Nothing 500s because
-- this file is unapplied.
--
--   * products.model_number (text, nullable): the manufacturer
--     model number as printed on the product / manufacturer page
--     (e.g. "SM-S928B" for a Galaxy S24 Ultra). It is a plain
--     recorded string, never guessed: 0 of the 10 live products
--     have a value today, and no seed, migration, or code path
--     invents one. A product without a recorded model number
--     reads as NULL and the UI hides the row (honest empty
--     state), exactly like GTIN today.
--   * The partial index covers only rows that carry a value, so
--     the 10 NULL rows cost nothing and a future model-number
--     lookup / dedupe leg can use it.
--   * No UNIQUE constraint: a model number alone does not prove
--     identity (the same model number can legitimately appear
--     under different regional variants), so uniqueness stays a
--     review-time dedupe question (services/pipeline/
--     deduplication.ts: findDuplicateCandidates), not a DB
--     constraint.
--   * Intake: the CSV column is `model_number` (optional). The
--     approve route stores it when the column exists and drops
--     it (flagging modelNumberUnsupported in the response) when
--     this migration is unapplied — the batch still inserts.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS model_number text NULL;

CREATE INDEX IF NOT EXISTS idx_products_model_number
  ON public.products (model_number)
  WHERE model_number IS NOT NULL;

COMMENT ON COLUMN public.products.model_number IS
  'Section 20 (#6): manufacturer model number, recorded verbatim from the manufacturer / merchant listing. NULL = not recorded (0/10 live products have one). Never guessed. DO NOT APPLY YET — owner step.';
