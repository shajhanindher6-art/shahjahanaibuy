-- 069 — product_images provenance (Final 100%, F-P1-56).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor). Until it is applied, the image pipeline
-- computes a per-image verificationStatus at read time
-- (services/pipeline/image-processing.ts) and then discards it —
-- nothing persists it. Nothing 500s because this file is unapplied.
--
-- APPLY ORDER: only after the 035–058 backlog clears; numeric
-- order 069 after 068. NEVER apply 035, and this file does not
-- depend on 035 or 053.
--
-- DEPENDENCIES: 002 (product_images table). The image-host
-- allowlist itself is owner-gated (IMAGE_ALLOWED_HOSTS, no host
-- known yet) — this file stores provenance, it does not invent
-- a host list.
--
--   * product_images.source_host (text, nullable): the hostname
--     the image URL was fetched from, for allowlist auditing.
--     NULL = not recorded. Never invented.
--   * product_images.verified_at (timestamptz, nullable): when
--     the image was last checked. NULL = never checked.
--   * product_images.verification_status (text, NOT NULL,
--     DEFAULT 'unverified', CHECK in ('unverified','verified',
--     'rejected')): the stored verdict. The default is
--     'unverified' — a row NEVER claims 'verified' without a
--     real check. Existing rows (0 live today) get 'unverified'.
--   * Index on (product_id, verification_status) for the admin
--     "unverified images" listing.
--
-- ROLLBACK (see also docs/migration-rollback-notes.md):
--   Rollback = drop the index, then drop the three columns:
--     DROP INDEX IF EXISTS public.idx_product_images_verification_status;
--     ALTER TABLE public.product_images DROP COLUMN IF EXISTS verification_status;
--     ALTER TABLE public.product_images DROP COLUMN IF EXISTS verified_at;
--     ALTER TABLE public.product_images DROP COLUMN IF EXISTS source_host;
--   Dropping the columns DESTROYS the stored provenance — that is
--   a destructive step: owner approval is required, and the owner
--   exports `SELECT * FROM product_images` first. Never roll back
--   silently; record the export in the cleanup-audit table (070).
--
-- SAFETY: every statement is guarded (ADD COLUMN IF NOT EXISTS /
-- CREATE INDEX IF NOT EXISTS), so a re-run converges. No explicit
-- transaction is used (Supabase SQL Editor runs statements
-- sequentially). RLS is unchanged: product_images is already
-- RLS-enabled with public read / no client write (002); these
-- columns are written only through the service-role client.

ALTER TABLE public.product_images
  ADD COLUMN IF NOT EXISTS source_host text NULL;

ALTER TABLE public.product_images
  ADD COLUMN IF NOT EXISTS verified_at timestamptz NULL;

ALTER TABLE public.product_images
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'verified', 'rejected'));

CREATE INDEX IF NOT EXISTS idx_product_images_verification_status
  ON public.product_images (product_id, verification_status);

COMMENT ON COLUMN public.product_images.source_host IS
  'Final 100% (069): hostname the image URL was fetched from (allowlist audit). NULL = not recorded. DO NOT APPLY YET — owner step.';
COMMENT ON COLUMN public.product_images.verified_at IS
  'Final 100% (069): when this image was last checked. NULL = never checked. DO NOT APPLY YET — owner step.';
COMMENT ON COLUMN public.product_images.verification_status IS
  'Final 100% (069): stored image verdict — unverified (default, never claims verified without a check), verified, rejected. DO NOT APPLY YET — owner step.';
