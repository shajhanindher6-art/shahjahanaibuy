# Migration rollback notes (Final 100%, F-P2-49)

**Status:** no migration file in this repo uses an explicit transaction,
and no `DOWN` / rollback script exists for any migration. That is the
honest gap (audit F-P2-49). This doc is the rollback guidance the
audit asked for: what recovery looks like today, and the per-migration
rollback for the new files 068–071 (each of which also carries its
rollback in its own header comments).

## Recovery today (all migrations, not just the new ones)

1. **Re-run the guarded file.** The chain's mitigation is idempotency:
   `CREATE TABLE/INDEX IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
   DO blocks guarded on `pg_constraint` / `information_schema` /
   `to_regclass()`. A failed-then-re-run apply converges instead of
   erroring. Read the `RAISE NOTICE` output — several files report
   what they skipped (045's duplicate guard, 057's labelled/unlabelled
   counts, 071's matched/unmatched slugs).
2. **A mid-file failure can still leave a half-applied migration**
   (early statements committed, later ones not), because Supabase SQL
   Editor runs statements sequentially with no implicit transaction
   wrapping. There is no way to roll that back automatically — the
   fix is the re-run in step 1, never a hand-edited partial revert.
3. **Policy drops are reversible by re-running the file.** The only
   destructive-adjacent statements in the chain are `DROP POLICY IF
   EXISTS` (RLS recreations, 010/011/015/unnumbered). A policy dropped
   and not recreated (mid-file failure) silently changes access —
   re-run the file and verify in `pg_policies`.
4. **Never roll back by deleting data.** A rollback that drops a
   column, a table, or a constraint destroys stored data or stored
   guarantees. Every rollback below is marked destructive where it
   is, requires explicit owner approval, and requires an export
   first (`SELECT * FROM <table>` / `pg_dump`).

## Per-file rollback — new migrations 068–071

| Migration | Rollback (owner approval required) | Destructive? |
|---|---|---|
| 068 GS1 CHECKs | `ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_gtin_gs1_check;` `ALTER TABLE public.product_variants DROP CONSTRAINT IF EXISTS product_variants_gtin_gs1_check;` `DROP FUNCTION IF EXISTS public.is_valid_gs1_gtin(text);` | No data lost — constraints + helper function only. The function is called by no code. |
| 069 image provenance | `DROP INDEX IF EXISTS public.idx_product_images_verification_status;` then `ALTER TABLE public.product_images DROP COLUMN IF EXISTS verification_status;` / `verified_at` / `source_host`; | **Yes — destroys stored provenance.** Export `SELECT * FROM product_images` first; record the export in the cleanup-audit table (070). |
| 070 cleanup audit table | `DROP TABLE IF EXISTS public.cleanup_actions;` | **Yes — destroys the audit trail.** Export first. Never drop while any cleanup it records is still un-restored. (Empty at apply time, so an immediate rollback destroys nothing.) |
| 071 brand/category backfill | `UPDATE public.products SET brand_id = NULL, category_id = NULL WHERE slug IN ('<slugs from the 071 NOTICE report>');` — only the matched slugs, never the whole table. | Linkage only (the free-text `brand`/`category` columns are never touched, so the original values are always recoverable). |

## Rollbacks that must NEVER happen

- **035 `api_key_quotas` — never apply, so never roll back.** It is a
  behaviour switch (per-instance in-memory quota → shared durable
  ledger, cross-instance 429 consequences). Owner decision only.
- **The unnumbered `20260718060823_fix_anonymous_access_policies.sql`
  — never apply as-is** (it would restrict public catalogue reads to
  authenticated users and break the public site). Its rollback is
  `supabase/fix-public-catalog-rls.sql`, run LAST per the runbook.
- **Any rollback that deletes production rows.** Deletions need a
  `cleanup_actions` row first (migration 070): documented reason +
  owner approval + full snapshot — see the audit §12.12 rule.
