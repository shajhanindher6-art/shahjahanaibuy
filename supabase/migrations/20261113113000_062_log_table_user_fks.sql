-- 062 — Foreign keys from log tables to auth.users (Sections 21–25, Stage I; audit §1 #91, I-P2-2).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor) AND it needs a live orphan check FIRST:
-- adding a foreign key FAILS if the table already holds a user_id
-- with no matching auth.users row. Before applying, run for each
-- table, e.g.:
--
--   SELECT count(*) FROM public.error_log e
--   WHERE e.user_id IS NOT NULL
--     AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = e.user_id);
--
--   SELECT count(*) FROM public.digest_failures d
--   WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = d.user_id);
--
-- and resolve any orphans the owner reviews (never delete rows
-- silently). Only apply once every count is 0. The DO guards
-- below protect against RE-RUNS only — they cannot fix orphans.
--
-- APPLY ORDER: only after the 035–058 backlog clears in numeric
-- order (audit §9 runbook: 045 → 047 → 048–050 → 051 → 052 →
-- 054 + 056 → 057 → 058, then 059–062). Applies after 048
-- (error_log) and 050 (digest_failures) — the tables it constrains
-- — and after 051, whose 12-table FK pattern this file follows.
-- NEVER apply 035, and this file does not depend on 035 or 053
-- (053 is dead without 035 and stays dead).
--
-- WHY NOT FOLDED INTO 051 (item 3 decision): 051 is a uniform
-- block — 12 user-owned tables, all `user_id uuid NOT NULL`,
-- all ON DELETE CASCADE, one shared orphan-check shape. These
-- two log tables break that uniformity in opposite directions
-- (see below), and 051's header documents exactly 12 tables;
-- folding in two differently-shaped FKs would make 051's scope
-- a lie. Keeping them in their own numbered migration keeps
-- 051's documented scope exact and puts the different delete
-- semantics where the owner can see them.
--
--   * error_log.user_id → auth.users(id) ON DELETE SET NULL:
--     error_log.user_id is NULLABLE (048: most application
--     errors have no user attached). A log row keeps its value
--     after its user is deleted — the error happened, and
--     deleting the log line with the account would destroy the
--     audit trail. SET NULL detaches the row, never deletes it.
--   * digest_failures.user_id → auth.users(id) ON DELETE
--     CASCADE: digest_failures.user_id is NOT NULL by 050's
--     design ("an anonymous digest failure cannot exist —
--     digests are per Premium subscriber"), so ON DELETE SET NULL
--     is IMPOSSIBLE on this column — Postgres rejects it. A
--     failure record for a deleted user is meaningless without
--     the user, so CASCADE is the only honest delete rule (the
--     same CASCADE 051 uses for user-owned rows). This is a
--     deliberate deviation from the brief's blanket "SET NULL on
--     delete": SET NULL applies to error_log only.
--   * Each block is DO-guarded three ways (051 pattern, extended):
--     the table must exist (048/050 unapplied → NOTICE + skip,
--     never a hard failure), the column must exist, and the
--     constraint must be absent — so a re-run never fails on a
--     half-applied state.
--   * No RLS change: the tables' existing policies stand. No
--     orphans are deleted here. Nothing is backfilled.

DO $$
BEGIN
  IF to_regclass('public.error_log') IS NULL THEN
    RAISE NOTICE '062: skipped error_log FK — table does not exist (apply migration 048 first, then re-run this file).';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'error_log'
      AND column_name = 'user_id'
  ) THEN
    RAISE NOTICE '062: skipped error_log FK — user_id column does not exist.';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'error_log_user_id_fkey'
      AND conrelid = 'public.error_log'::regclass
  ) THEN
    ALTER TABLE public.error_log
      ADD CONSTRAINT error_log_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.digest_failures') IS NULL THEN
    RAISE NOTICE '062: skipped digest_failures FK — table does not exist (apply migration 050 first, then re-run this file).';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'digest_failures'
      AND column_name = 'user_id'
  ) THEN
    RAISE NOTICE '062: skipped digest_failures FK — user_id column does not exist.';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'digest_failures_user_id_fkey'
      AND conrelid = 'public.digest_failures'::regclass
  ) THEN
    ALTER TABLE public.digest_failures
      ADD CONSTRAINT digest_failures_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;
