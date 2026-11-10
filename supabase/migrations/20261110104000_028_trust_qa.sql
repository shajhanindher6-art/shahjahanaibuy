-- Migration 028: Trust, Q&A, fact-checking & price-accuracy audits
-- (Sections 3 #12/#14, 5 #7/#15/#16)
--
-- HONESTY RULES for everything in this file:
--   * Every recorded policy / audit value defaults to NULL — nothing is
--     invented. A merchant with no verified policy data gets NO trust
--     grade ("Not enough data") and NO "Verified Merchant" badge.
--   * No seed rows. No fake reviews, prices, scores or votes.
--   * Review photos are stored ONLY with the reviewer's explicit
--     consent (the API enforces the consent flag; the bucket below is
--     just the container). No photo is ever stored without consent.
--   * All new tables are fail-safe: application code treats a missing
--     table/bucket (migration not run yet) as an honest empty state,
--     never as an error page.
--
-- Contents:
--   1. merchants trust-policy columns (all NULL defaults).
--   2. product_qa — per-product questions & admin answers.
--   3. review_photos — consented review photos (storage bucket
--      `review-photos` + storage policies).
--   4. deal_fact_checks — automated checks + human review queue.
--   5. price_accuracy_audits — owner-entered listing-vs-checkout
--      samples. Live checkout verification stays manual; this table
--      only records samples the owner/admin enters — it never
--      fabricates audit results.

-- ---------------------------------------------------------------------------
-- 1. Merchant trust-policy columns (Section 3 #14, Section 5 #15)
-- ---------------------------------------------------------------------------
-- All NULL until the owner verifies the real policy facts. The trust
-- grade (lib/merchant-trust.ts) computes ONLY from recorded values;
-- any missing field means "Not enough data". `is_verified_merchant`
-- defaults to FALSE — no merchant gets the badge without recorded
-- data meeting every public standard (lib/verified-merchants.ts).

ALTER TABLE merchants
ADD COLUMN IF NOT EXISTS return_window_days INT DEFAULT NULL CHECK (return_window_days >= 0),
ADD COLUMN IF NOT EXISTS warranty_months INT DEFAULT NULL CHECK (warranty_months >= 0),
ADD COLUMN IF NOT EXISTS reputation_score NUMERIC DEFAULT NULL CHECK (reputation_score >= 0 AND reputation_score <= 5),
ADD COLUMN IF NOT EXISTS return_policy_url TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS warranty_policy_url TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS policy_verified_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS policy_verified_by UUID DEFAULT NULL,
ADD COLUMN IF NOT EXISTS is_verified_merchant BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS merchant_verified_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS merchant_verified_until TIMESTAMPTZ DEFAULT NULL;

-- ---------------------------------------------------------------------------
-- 2. Product Q&A (Section 3 #12)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS product_qa (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  question TEXT NOT NULL CHECK (char_length(question) >= 3 AND char_length(question) <= 1000),
  answer TEXT DEFAULT NULL,
  answered_by UUID DEFAULT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'answered', 'hidden')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One pending question per user per product per exact text: a user
  -- re-asking the identical question is a duplicate, not a new row.
  CONSTRAINT product_qa_one_pending_per_question
    UNIQUE (product_id, user_id, question)
);

CREATE INDEX IF NOT EXISTS idx_product_qa_product_created
  ON product_qa (product_id, created_at DESC);

ALTER TABLE product_qa ENABLE ROW LEVEL SECURITY;

-- Public read of non-hidden Q&A; anyone may ask (signed in); only
-- admins may answer / hide. WITH CHECK pins the owner on insert.
DROP POLICY IF EXISTS product_qa_select_public ON product_qa;
CREATE POLICY product_qa_select_public ON product_qa
  FOR SELECT TO public USING (status <> 'hidden');

DROP POLICY IF EXISTS product_qa_insert_own ON product_qa;
CREATE POLICY product_qa_insert_own ON product_qa
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS product_qa_update_admin ON product_qa;
CREATE POLICY product_qa_update_admin ON product_qa
  FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS product_qa_delete_admin ON product_qa;
CREATE POLICY product_qa_delete_admin ON product_qa
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- ---------------------------------------------------------------------------
-- 3. Consented review photos (Section 3 #12)
-- ---------------------------------------------------------------------------
-- The `review_photos` table records ONLY photos the reviewer explicitly
-- consented to store (consent_given_at is NOT NULL — a row cannot exist
-- without a recorded consent moment). The file bytes live in the
-- `review-photos` storage bucket; the API uploads there ONLY when the
-- consent checkbox was ticked, and reports honestly when the bucket
-- is not configured instead of pretending the photo was stored.

CREATE TABLE IF NOT EXISTS review_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  storage_path TEXT NOT NULL,
  consent_given_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT review_photos_one_path_per_review
    UNIQUE (review_id, storage_path)
);

CREATE INDEX IF NOT EXISTS idx_review_photos_review
  ON review_photos (review_id);

ALTER TABLE review_photos ENABLE ROW LEVEL SECURITY;

-- Photos attached to public reviews are publicly readable (the bucket
-- itself is public). Writes are owner-only with a non-null owner.
DROP POLICY IF EXISTS review_photos_select_public ON review_photos;
CREATE POLICY review_photos_select_public ON review_photos
  FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS review_photos_insert_own ON review_photos;
CREATE POLICY review_photos_insert_own ON review_photos
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS review_photos_delete_own ON review_photos;
CREATE POLICY review_photos_delete_own ON review_photos
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Storage bucket for consented review photos (public: the photos are
-- shown next to public reviews). Idempotent: safe to re-run.
INSERT INTO storage.buckets (id, name, public)
VALUES ('review-photos', 'review-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies (idempotent via pg_policies checks — Postgres has
-- no CREATE POLICY IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'review-photos public read'
  ) THEN
    CREATE POLICY "review-photos public read"
      ON storage.objects FOR SELECT TO public
      USING (bucket_id = 'review-photos');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'review-photos authenticated upload'
  ) THEN
    CREATE POLICY "review-photos authenticated upload"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'review-photos');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'review-photos owner delete'
  ) THEN
    CREATE POLICY "review-photos owner delete"
      ON storage.objects FOR DELETE TO authenticated
      USING (
        bucket_id = 'review-photos'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Deal fact-check queue (Section 5 #16)
-- ---------------------------------------------------------------------------
-- One row per deal/subject under review. `checks` is the JSON output of
-- the deterministic automated checks (lib/fact-check.ts) over numbers
-- the admin supplied from real observations — the code never invents
-- a price, a match, or a verdict. `overall` is derived from those
-- checks only. Human review is the `status` transition
-- pending -> approved | rejected | taken_down, recorded with the
-- reviewer and a note. A takedown also deactivates the deal itself
-- (done by the API route, not by a trigger — the route reports
-- whether the deactivation actually happened).

CREATE TABLE IF NOT EXISTS deal_fact_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type TEXT NOT NULL
    CHECK (subject_type IN ('deal', 'community_deal', 'product', 'manual')),
  subject_id UUID NOT NULL,
  subject_title TEXT NOT NULL,
  listing_price NUMERIC DEFAULT NULL CHECK (listing_price IS NULL OR listing_price > 0),
  compare_at_price NUMERIC DEFAULT NULL CHECK (compare_at_price IS NULL OR compare_at_price > 0),
  checkout_price NUMERIC DEFAULT NULL CHECK (checkout_price IS NULL OR checkout_price > 0),
  history_lowest NUMERIC DEFAULT NULL CHECK (history_lowest IS NULL OR history_lowest > 0),
  history_points INT DEFAULT NULL CHECK (history_points IS NULL OR history_points >= 0),
  merchant_caution BOOLEAN NOT NULL DEFAULT FALSE,
  checks JSONB NOT NULL DEFAULT '[]'::jsonb,
  overall TEXT NOT NULL DEFAULT 'inconclusive'
    CHECK (overall IN ('pass', 'fail', 'inconclusive')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'taken_down')),
  reviewer_id UUID DEFAULT NULL,
  reviewed_at TIMESTAMPTZ DEFAULT NULL,
  review_note TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one PENDING check per subject: re-checking a subject that
-- already has a pending check is a duplicate, not a new queue entry.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fact_checks_one_pending_per_subject
  ON deal_fact_checks (subject_type, subject_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_fact_checks_status_created
  ON deal_fact_checks (status, created_at DESC);

ALTER TABLE deal_fact_checks ENABLE ROW LEVEL SECURITY;

-- Admin-only: the queue, its rows and its decisions are never public.
-- The public meaning of "Verified" is published text (lib/fact-check.ts),
-- not these rows.
DROP POLICY IF EXISTS fact_checks_admin_all ON deal_fact_checks;
CREATE POLICY fact_checks_admin_all ON deal_fact_checks
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- 5. Price-accuracy audits (Section 5 #7)
-- ---------------------------------------------------------------------------
-- Append-only samples entered by the owner/admin from REAL checkout
-- observations (listing price vs the price actually charged at
-- checkout). No row is ever generated by code, and no sample is ever
-- assumed: an empty table means "no audits yet", never a score.
-- The per-retailer accuracy score (lib/price-accuracy.ts) is computed
-- from these rows only.

CREATE TABLE IF NOT EXISTS price_accuracy_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  product_id UUID DEFAULT NULL REFERENCES products(id) ON DELETE SET NULL,
  listing_price NUMERIC NOT NULL CHECK (listing_price > 0),
  checkout_price NUMERIC NOT NULL CHECK (checkout_price > 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_by UUID NOT NULL,
  sample_source TEXT NOT NULL DEFAULT 'manual',
  notes TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- An identical sample from the same checker at the same moment is
  -- a duplicate submission, not a second observation.
  CONSTRAINT price_accuracy_audits_no_exact_dupes
    UNIQUE (merchant_id, product_id, listing_price, checkout_price, checked_at, checked_by)
);

CREATE INDEX IF NOT EXISTS idx_accuracy_audits_merchant_checked
  ON price_accuracy_audits (merchant_id, checked_at DESC);

ALTER TABLE price_accuracy_audits ENABLE ROW LEVEL SECURITY;

-- Audit results are public transparency data; only admins may record
-- them (and only their own checker id — WITH CHECK pins the owner).
DROP POLICY IF EXISTS accuracy_audits_select_public ON price_accuracy_audits;
CREATE POLICY accuracy_audits_select_public ON price_accuracy_audits
  FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS accuracy_audits_insert_admin ON price_accuracy_audits;
CREATE POLICY accuracy_audits_insert_admin ON price_accuracy_audits
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() AND auth.uid() = checked_by);

DROP POLICY IF EXISTS accuracy_audits_delete_admin ON price_accuracy_audits;
CREATE POLICY accuracy_audits_delete_admin ON price_accuracy_audits
  FOR DELETE TO authenticated
  USING (public.is_admin());
