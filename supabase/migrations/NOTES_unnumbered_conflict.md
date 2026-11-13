# Unnumbered-migration vs `fix-public-catalog-rls.sql` conflict — DECISION NOTE

Sections 21–25, Stage I (audit §1 P1 #41). **Files only — do not rename
or edit either conflicting file.** This note states the final state and
the order the owner must use when applying. Applied status of both
files is UNKNOWN from the repo — only the owner can check
`schema_migrations` / `pg_policies`.

## The two files

| File | Location | Policies | Grant |
|---|---|---|---|
| `20260718060823_fix_anonymous_access_policies.sql` (unnumbered) | `supabase/migrations/` | 13 SELECT policies | `TO authenticated` only |
| `fix-public-catalog-rls.sql` | `supabase/` (repo root — NOT in `migrations/`, so NOT part of the automatic numbered chain) | 10 SELECT policies | `TO anon, authenticated` |

## What actually conflicts (verified by reading both files)

8 policy names appear in BOTH files with the **same USING filter**
and **opposite grants** — last-applied wins:

`read_deals`, `read_coupons`, `read_cashback_offers`,
`read_deal_rankings`, `reviews_select_all`, `read_products`,
`read_retailers`, `read_price_history`.

(The audit's "14/11" is the grep count including one `TO ...` hit in
each file's header comment. The real policy counts are 13 vs 10.)

- Unnumbered-only tables (5, stay `TO authenticated` under the order
  below): `ai_predictions`, `ai_summaries`, `product_attributes`,
  `product_images`, `product_variants`.
- `fix-public-catalog-rls.sql`-only tables (2, `TO anon,
  authenticated`): `merchants`, `merchant_products`.

## DECISION — final state

The `fix-public-catalog-rls.sql` state WINS for the 8 overlapping
policies: public catalog reads are `TO anon, authenticated`.

Why: the public site is used logged-out. The unnumbered file's
`TO authenticated`-only grants hide every catalog row from the anon
key — that is exactly the live bug `fix-public-catalog-rls.sql` was
written to solve (2026-10-31: deals, merchants, coupons, cashback
and product merchants returned `[]` for logged-out visitors while
the seed rows existed). The unnumbered file was written to silence
Supabase security-advisor lint 0012 (auth allow-anonymous-sign-ins),
but silencing the lint by breaking logged-out reads trades a
dashboard warning for a broken public site. The lint concern is
real but secondary: anon can only SELECT these catalog rows (no
INSERT / UPDATE / DELETE policy is touched by either file).

## ORDER the owner must use

1. Apply the numbered chain **including** the unnumbered file first
   (its timestamp `20260718060823` sorts it between 015 and 016 —
   if it was already applied once, do NOT re-run it).
2. Run `supabase/fix-public-catalog-rls.sql` **LAST**, after the
   whole chain.
3. **Never re-run the unnumbered file after step 2.** Re-running it
   re-applies `TO authenticated` on the 8 overlapping policies and
   re-breaks logged-out reads (the 2026-10-31 bug returns).
4. Verify in the Supabase dashboard (`pg_policies`): the 8 policies
   above must show `TO anon, authenticated`. If any shows
   `TO authenticated` only, re-run `fix-public-catalog-rls.sql`
   (it is idempotent: DROP POLICY IF EXISTS + CREATE POLICY).

## Open owner question (not decided here)

The 5 unnumbered-only tables stay `TO authenticated` under this
order. Two of them — `product_images` and `product_attributes` —
are read by public product pages; if the live site ever shows
missing images/specs to logged-out visitors, the owner must decide
whether those two policies also need `TO anon, authenticated`
(the same treatment as the 8 above) or whether the anon reads are
served another way. `ai_predictions` / `ai_summaries` /
`product_variants` are not public-read tables today — leave them
authenticated-only unless a surface needs them. Do NOT extend
`fix-public-catalog-rls.sql` for this without that decision.
