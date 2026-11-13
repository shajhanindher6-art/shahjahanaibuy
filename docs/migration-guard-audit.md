# Migration guard audit — pending files (Final 100%, F-P2-50)

**Audited:** 2026-11-13, Final 100% Worker W7, by reading every statement of
each file listed below. **Scope:** the pending migrations 059–063, 065–067
(written in Sections 21–25, NOT applied) plus the new 068–071 (written in
this slice, NOT applied). Older files (001–058) were spot-checked only in
earlier audits — this audit does NOT claim a full 64-file guard audit.

**Method note:** a mechanical `;`-split of a migration file MISLEADS — the
semicolons inside `DO $$ ... $$` blocks and inside COMMENT strings are not
statement boundaries. Every verdict below is from reading the file, not
from the split. A statement counts as **guarded** when a re-run of the
whole file converges: `IF NOT EXISTS` / `IF EXISTS`, a DO block that
checks `pg_constraint` / `information_schema` / `to_regclass()` first,
`CREATE OR REPLACE`, an idempotent UPDATE (`WHERE <column> IS NULL`),
or a `CREATE POLICY` that is preceded in the same file by
`DROP POLICY IF EXISTS` for the same name. `COMMENT ON` and
`ALTER TABLE ... ENABLE ROW LEVEL SECURITY` are idempotent by nature
and need no guard. A `VALIDATE CONSTRAINT` on an already-validated
constraint is a no-op success.

**Verdict: every statement in every file below is guarded / re-runnable.
No file needs a guard fix before the owner applies it.** The remaining
risk is the one the audit already records (F-P2-49): no file uses an
explicit transaction, so a mid-file failure can leave a half-applied
migration — recovery is re-running the (guarded) file and reading the
NOTICE output; see `docs/migration-rollback-notes.md`.

## Per-file checklist

| File | Statements | Verdict |
|---|---|---|
| 059 `products_data_quality` | 3× `ADD COLUMN IF NOT EXISTS` (with CHECK on the score column), 1× `CREATE INDEX IF NOT EXISTS`, COMMENTs | ✅ All guarded. No backfill (by design — no score is persisted without a real computation). |
| 060 `price_history_currency_code` | Pre-flight DO block (raises EXCEPTION — aborts, changing nothing — if `currency` is missing or any row is non-USD), `ADD COLUMN IF NOT EXISTS`, `UPDATE ... WHERE currency_code IS NULL` (idempotent verbatim copy), `SET DEFAULT` (idempotent), COMMENT | ✅ All guarded. The pre-flight is the guard: a bad state fails safe before any change. |
| 061 `merchant_reliability` | `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `ENABLE RLS` (idempotent), `DROP POLICY IF EXISTS` + `CREATE POLICY` (same name, same file — re-run recreates it) | ✅ All guarded. |
| 062 `log_table_user_fks` | 2× DO blocks: `to_regclass()` table check → `information_schema.columns` check → `pg_constraint` check before `ADD CONSTRAINT`; missing table → NOTICE + skip (never an error) | ✅ All guarded. Owner pre-condition still applies: apply 048 + 050 FIRST (062 FKs those tables) and run the orphan check first. |
| 063 `alert_expiry` | 2× `ADD COLUMN IF NOT EXISTS`, 2× `UPDATE ... WHERE expires_at IS NULL` (idempotent backfill), 2× `CREATE INDEX IF NOT EXISTS`, DO block guarded on `pg_constraint` for the `alert_type` CHECK (`NOT VALID`, validated later) | ✅ All guarded. |
| 065 `ai_recommendation_audit` | `CREATE TABLE IF NOT EXISTS`, 2× `CREATE INDEX IF NOT EXISTS`, `ENABLE RLS`, `DROP POLICY IF EXISTS` + `CREATE POLICY` | ✅ All guarded. |
| 066 `products_last_successful_update` | 1× `ADD COLUMN IF NOT EXISTS`, COMMENT | ✅ All guarded. No backfill (by design — a check is not a save). |
| 067 `ai_usage_ledger` | `CREATE TABLE IF NOT EXISTS`, 3× `CREATE INDEX IF NOT EXISTS`, `ENABLE RLS`, `DROP POLICY IF EXISTS` + `CREATE POLICY` | ✅ All guarded. |
| 068 `gtin_gs1_check` (new) | `CREATE OR REPLACE FUNCTION is_valid_gs1_gtin` (idempotent), pre-flight DO block (RAISE EXCEPTION on any invalid stored GTIN — aborts before any change), 2× DO blocks guarded on `pg_constraint` adding the CHECKs `NOT VALID`, 2× `VALIDATE CONSTRAINT` (no-op when already validated) | ✅ All guarded. Depends on 056 (the `product_variants.gtin` column). |
| 069 `product_images_provenance` (new) | 3× `ADD COLUMN IF NOT EXISTS` (status column with CHECK + DEFAULT 'unverified'), `CREATE INDEX IF NOT EXISTS`, COMMENTs | ✅ All guarded. Default 'unverified' never claims a check that did not happen. |
| 070 `cleanup_actions_audit` (new) | `CREATE TABLE IF NOT EXISTS`, 2× `CREATE INDEX IF NOT EXISTS`, `ENABLE RLS`, `DROP POLICY IF EXISTS` + `CREATE POLICY` (admin-only SELECT; deliberately NO INSERT/UPDATE/DELETE policy — append-only) | ✅ All guarded. Precondition for ANY future production deletion. |
| 071 `brand_category_backfill` (new) | Single DO block: table-existence pre-flight (RAISE EXCEPTION, aborts before any change), exact-match-only UPDATEs with `WHERE brand_id/category_id IS NULL` (idempotent; already-linked rows never overwritten), NOTICE report of matched + unmatched slugs | ✅ All guarded. No FK is added (004 already created them). Unmatched rows stay NULL and are reported, never fuzzy-matched. |

## What this audit does NOT cover

- Files 001–058: spot-checked in earlier audits only (045, 047, 051, 052,
  057, 060, 062, 063 verified guarded). A full per-statement audit of
  the remaining ~50 files is still open as a checklist item — it is a
  documentation task, not a reason to block the corrected apply order
  in `docs/migration-runbook.md`, because every file the owner is
  asked to apply next (047, 045, 040, 048, 050, 052, 055–058, 059–063,
  065–067, 068–071) is covered here or was verified guarded before.
- No 064 file exists (063 → 065). The gap is numbering hygiene only
  (F-P2-14): do NOT create a 064 file, do NOT reuse the number.
- Applied status of every file is UNKNOWN from the repo (only 044 is
  proven live). The owner checks `supabase_migrations.schema_migrations`
  first (runbook Phase 0).
