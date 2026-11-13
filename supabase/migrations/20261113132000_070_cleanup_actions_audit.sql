-- 070 — cleanup / quarantine audit table (Final 100%, F-P1-56).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor). The table starts EMPTY — it stores no
-- data by itself.
--
-- WHY THIS IS A P1 PRECONDITION: the audit found 0 rows that
-- qualify for deletion today (0 duplicates, 0 invalid GTINs/images,
-- the 10 products ARE the live catalog, sample-laptop is a
-- health-check row by design). Any FUTURE deletion — a real
-- duplicate, a wrong merchant mapping, an orphan — must have
-- somewhere to record its reason + owner approval + a restorable
-- snapshot BEFORE the row is touched. Without this table, the
-- §12.12 preservation rule ("documented reason + owner approval +
-- preservation plan + a row in the report") has nowhere to live.
-- No production deletion may happen until 070 is applied AND a
-- row is written here first. This file creates the table only;
-- it deletes nothing.
--
-- APPLY ORDER: only after the 035–058 backlog clears; numeric
-- order 070 after 069. It has NO dependency on any other table
-- (standalone), but the numeric order keeps the chain auditable.
-- NEVER apply 035, and this file does not depend on 035 or 053.
--
--   * cleanup_actions: one row per proposed/performed cleanup.
--     - table_name (text, NOT NULL): the table the row came from.
--     - row_id (uuid, NULL): the row's id when it has one.
--     - slug (text, NULL): the row's slug when it has one.
--     - reason (text, NOT NULL): WHY, in words — an empty reason
--       is not a cleanup, it is data loss.
--     - approved_by (uuid, NULL) + approved_at (timestamptz,
--       NULL): the owner who approved it, and when. NULL =
--       not yet approved — an unapproved row must never be acted on.
--     - snapshot (jsonb, NOT NULL): the FULL row as JSON before
--       the change — the restorable preservation copy. A row with
--       no snapshot cannot be acted on.
--     - restored_at (timestamptz, NULL): when the row was restored
--       from its snapshot, if it ever was.
--     - created_at (timestamptz, NOT NULL, DEFAULT now()).
--   * RLS: enabled. Admin-only SELECT (via is_admin(), 017).
--     NO anon/authenticated INSERT, UPDATE or DELETE policy —
--     rows are written only through the service-role client (the
--     same pattern as error_log, migration 048). Append-only by
--     design: no UPDATE/DELETE policy exists at all.
--   * Indexes: (table_name, created_at) for the admin listing;
--     (slug) for lookup by slug.
--
-- ROLLBACK (see also docs/migration-rollback-notes.md):
--   Rollback = DROP TABLE IF EXISTS public.cleanup_actions;
--   That DESTROYS the audit trail — a destructive step: owner
--   approval is required, and the owner exports the table first
--   (`SELECT * FROM cleanup_actions`). Never drop this table
--   while any cleanup it records is still un-restored. The table
--   is new and empty at apply time, so an immediate rollback
--   (before any row is written) destroys nothing.
--
-- SAFETY: every statement is guarded (CREATE TABLE IF NOT EXISTS /
-- CREATE INDEX IF NOT EXISTS / DROP POLICY IF EXISTS before
-- CREATE POLICY), so a re-run converges. No explicit transaction
-- is used (Supabase SQL Editor runs statements sequentially).

CREATE TABLE IF NOT EXISTS public.cleanup_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  row_id uuid NULL,
  slug text NULL,
  reason text NOT NULL,
  approved_by uuid NULL,
  approved_at timestamptz NULL,
  snapshot jsonb NOT NULL,
  restored_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cleanup_actions IS
  'Final 100% (070): audit trail for ANY future production cleanup/deletion. A row here (reason + owner approval + full snapshot) is required BEFORE a production row is touched. Append-only. DO NOT APPLY YET — owner step.';

CREATE INDEX IF NOT EXISTS idx_cleanup_actions_table_created
  ON public.cleanup_actions (table_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cleanup_actions_slug
  ON public.cleanup_actions (slug) WHERE slug IS NOT NULL;

ALTER TABLE public.cleanup_actions ENABLE ROW LEVEL SECURITY;

-- Admin-only SELECT. Deliberately NO INSERT/UPDATE/DELETE policy:
-- RLS default-deny rejects any client write, including by admins.
-- Writes go through the service-role client only (same pattern as
-- error_log, migration 048). No UPDATE/DELETE policy exists at all:
-- the trail is append-only.
DROP POLICY IF EXISTS "cleanup_actions_select_admin" ON public.cleanup_actions;
CREATE POLICY "cleanup_actions_select_admin" ON public.cleanup_actions
  FOR SELECT TO authenticated
  USING (public.is_admin());
