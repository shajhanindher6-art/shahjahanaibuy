# Migration runbook — corrected apply order (Final 100%, F-P1-55)

**Created:** 2026-11-13 (Final 100%, Worker W7). **Supersedes the order in
`docs/owner-checklist-045-058.md` §1** (that doc's §1 listed 045 first;
the corrected order below is 047 first — the checklist is updated to
point here). The detailed per-migration owner checklist (pre-checks,
live proof, record table) stays in `docs/owner-checklist-045-058.md`;
this doc is the ORDER + the blocking dependencies. The owner-action
gate (M-0…M-11 — eBay, Best Buy, Amazon, Skimlinks, Resend+VAPID,
Stripe, cron-job.org, migrations, 044, auth/Upstash, CI/CSV) is in
`docs/owner-checklist-045-058.md` §5; migrations are M-8 of that gate.

**Standing rules (never overridden by this runbook):**
- Migrations are FILES ONLY in the build. Nothing here is applied by
  code. The owner applies each file ONCE, in the Supabase dashboard
  SQL Editor, only with explicit approval for that migration.
- **NEVER apply 035** (`api_key_quotas`) without a separate explicit
  review — it is a behaviour switch (per-instance in-memory quota →
  shared durable ledger, cross-instance 429 consequences). 053 is
  dead without 035; do not apply 053 either unless 035 is lifted.
- **NEVER apply the unnumbered
  `supabase/migrations/20260718060823_fix_anonymous_access_policies.sql`
  as-is** — it would restrict public catalogue reads to authenticated
  users and break the public site. The RLS final state is Phase 9.
- **No 064 file exists** (063 → 065). Numbering hygiene only
  (F-P2-14): do NOT create a 064 file, do NOT reuse the number.
- Applied status of every migration is UNKNOWN from the repo (only
  044 is proven live, by the `/creators` 404). Phase 0 first, always.
- 7 files carry a double `.sql.sql` suffix (008–014). Harmless — do
  NOT rename them (a rename could break `schema_migrations` version
  matching if any was applied under the double-suffix name).

## Phase 0 — Verify first (owner, before any apply)

```sql
SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;
```

Compare against the 64 `.sql` files in `supabase/migrations/` (+ the
`NOTES_unnumbered_conflict.md` decision note, which is NOT a migration).
Record applied / not applied / unknown per file. Run the 051/062
orphan checks and the 045/054 duplicate checks (see the owner
checklist §2). Take a manual `pg_dump` export first (free tier has no
automated backups). If any check fails, stop at that migration — do
not skip ahead.

## The corrected order

| Phase | File(s) | Why this position (blocking dependency) |
|---|---|---|
| 1 — Security | **047** | **FIRST.** P0 self-promotion hole: any signed-in user can set their own `role_id` to admin. Security before catalog gating. File is fixed in place to `auth.uid()`. Does NOT guard INSERT — that gap stands and is documented. |
| 1 — Security | (decision) re-apply amended **017** + 028 blocks | 017 was (presumably) applied in its OLD form; the amended file replaces `is_admin()` (+ `SET search_path`) and the audit-log append-only policies. A deliberate re-apply with a `pg_policies` verification after — NOT "just the next file". Same for the 028 folder-scope fix. |
| 2 — Foundation | 016 → 026 → 027 → 028 → 029 → 030 → 031 → 032 → 033 → 034 (timestamp order; 018–023 sit in this range) | Section 3–7 foundation. 018 needs `supabase/add-smartpools.sql` first; 031 needs `supabase/add-community-deals.sql` first (both are now DO-guarded in file, but the owner tables must still exist). 033 was proven NOT applied live (PGRST205 on `live_shopping_sessions`); `/live` 404s work via middleware without it. |
| 3 — Catalog gate | **045** (after the duplicate pre-check) → 055 → 056 → 057 (file fix verified — DO guard + seed-instant-scoped backfill) → 058 | 045 first in this phase so the price-history dedupe state is known before 057's backfill labels rows. 060 comes AFTER 057 (its header states the currency backfill assumes 057's provenance labelling ran first). |
| 4 — Observability | 040 → 048 → 049 → 050 → **052** (after the 2-running-rows pre-check) | **040 BEFORE 052 — blocking:** 052's unique partial index is on `price_refresh_runs`, which only 040 creates. Applying 052 first fails outright. |
| 5 — Features | 036 → 037 → 038 → 039 → 041 → 042 → 043 → 054 (after the deals dedupe pre-check) | 041 is the eBay daily-usage counter (falls back to Upstash Redis until applied). |
| 6 — Integrity | 051 (after the orphan check) → **062** (after the orphan check) | **048 + 050 BEFORE 062 — blocking:** 062 adds FKs to `error_log` (048) and `digest_failures` (050). Applying 062 first fails outright. Adding an FK FAILS on orphan rows — never delete rows silently to clear orphans; the owner reviews them first. |
| 7 — Sections 21–25 | 059 → 060 (after 057) → 061 → 063 → 065 → 066 → 067 | Guard audit for all of these: `docs/migration-guard-audit.md` — every statement verified guarded / re-runnable. |
| 8 — Final 100% (new) | **068** (after 056 — the `product_variants.gtin` column must exist) → 069 → 070 → 071 | 068 adds GS1 CHECKs only (the variant GTIN column itself is already in 056 — see the 068 header correction). 070 is the precondition for ANY future production deletion. 071 is exact-match-only backfill with a NOTICE report. Guard audit + rollback notes: `docs/migration-guard-audit.md`, `docs/migration-rollback-notes.md`. |
| — Excluded | **053** | Dead without 035. Never bundled with this run. |
| — Skipped | **044** | Already applied (live `/creators/unknown-slug-xyz` → 404). Do NOT re-run. The `project-summary.md` lines saying NOT applied are left EXACTLY as written until the owner re-confirms 044 in `schema_migrations` (gate M-9). |
| 9 — RLS final state (LAST) | Unnumbered `20260718060823_fix_anonymous_access_policies.sql` (only if never applied — do NOT re-run if it was) → `supabase/fix-public-catalog-rls.sql` | Per `supabase/migrations/NOTES_unnumbered_conflict.md`: the two files conflict on 8 overlapping policy names with opposite grants; the `fix-public-catalog-rls.sql` state wins, run LAST, never re-run the unnumbered file after it. Verify the 8 policies show `TO anon, authenticated` in `pg_policies`. |

## After each file

Verify with the M-0 query + a column/table check (the owner checklist
§4 lists the live proof per migration, e.g. 045 → the verification
columns exist; 047 → a signed-in non-admin can no longer set their own
`role_id`; 040 → `/admin/refresh-runs` stops saying "no run recorded").
Record the result in the checklist §6 record table.
