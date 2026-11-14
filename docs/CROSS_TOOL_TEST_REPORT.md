# Cross-Tool Test Report — SmartBuy AI Master Tool Integration

**Date:** 2026-11-14 · **Status:** Stages 0–6 gated and live (HEAD `6838d30a`, recheck 15:25 PKT 7/7 PASS)
**Sources:** per-stage reports in `~/workspace/master-tool-integration/build/` (`stage0-report.md` … `stage6-report.md`, `gate-stages-0-2.md`); the parent agent's own gate run (`my-gate-run.log`); `BUILD_MANIFEST.md`.

> Every number below is quoted from a stage report or the parent's gate log. Nothing here is a claim about a run that did not happen. Parallel vitest runs are flaky in this repo — serial runs are the authority, and every full-suite number below is a serial run.

## 1. Headline — the final gate (parent's own run, final tree)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| Full serial vitest (`npm run test:ci-log`) | **338 files passed (338), 4,725 tests passed, 4 skipped, 0 failed** |
| `npm run test:a11y` | **6 files, 33/33 passed** |
| `npm run lint` | 0 warnings/errors |
| Clean build (`rm -rf .next`, placeholder env) | exit 0, **820/820 pages** |
| Press counts | **4,725 tests / 338 files, 2026-11-14** (re-locked; old 4,526/332 absent live) |

The Stage 6 worker ran the same full serial suite twice with identical numbers (338 / 4,725 / 4 skipped / 0 failed, ~141s each). The parent's independent re-run matched exactly.

## 2. Test layers (what was added, what each asserts)

### Layer 1 — Unit: the service itself (Stage 1)

**File:** `tests/tool-integration.test.ts` — **32/32 pass.**

Asserts: param-schema parsing for every dialect (`?product=`, T1 `?current=/ ?successor=`, T10 `?device=/ ?accessory=`, T2 persona/budget, T3 status, T4 typed fields, `/compare` UUIDs, `buildToolUrl` inverse); cached-fetch behaviour (second identical call hits the cache, not Supabase — proven with a `vi.mock` counting stub at the cross-module boundary and a minimal fake Supabase client); all 11 link builders emit the destination's own dialect and never an empty `?product=` / `?device=` / `?current=`; `relatedToolLinks` returns only existing routes and `[]` for an unknown tool.

### Layer 2 — Unit: the decision orchestrator (Stage 4)

**File:** `tests/shopping-decision.test.ts` — **11/11 pass.**

Asserts (delegates mocked): the orchestrator calls decision-matrix + buy-wait-prediction + ai-comparison and combines their outputs; the verdict is withheld below 5 data points; the cheaper-alternative price passed to the delegate is the lowest listing. The orchestrator re-implements nothing — the tests assert delegation (the mocks are called with the right inputs), not re-implemented logic.

### Layer 3 — Unit: the journey (Stage 5)

**File:** `tests/guided-journey.test.ts` — **22/22 pass.**

Asserts: the 13-step order; every step resolves to an existing route; product params are carried through the journey links; entry/exit at any step (no step requires the previous one).

### Layer 4 — Wiring: links, params, cache (Stage 3)

**File:** `tests/tool-integration-wiring.test.ts` — **75/75 pass.** Stage 3 affected tests: **255/255** (13 files: the 10 tool suites + `tool-integration` + `section16-save-calculation-tools` + `section16-retention-monetization`).

Asserts: every link builder's URL parses back to the same product via `parseToolParams` (all dialects, round-trip); `relatedToolLinks` — only existing routes, product carried in the destination's own dialect, never an empty param, null product → no product param anywhere, unknown tool → `[]`; cached-fetch wiring (second call hits cache); source-level assertions that the 9 pages call the cached variants and never the uncached ones; `RelatedTools` mounted 10/10; `SaveCalculationButton` on the 8 replayable tools and absent on T3/T7; `ProductTools` on the product page + `/compare`; T2 stored-budget wiring; saved-URL behaviour for the 8 tools + bare route for T3/T7.

### Layer 5 — Page/render: all 10 tools render (Stage 6)

**File:** `tests/tool-pages.test.ts` — **31/31 pass.**

Pattern (existing, not invented): async server page awaited + `renderToStaticMarkup` (node env, `.test.ts`, no JSX), as in `tests/section21-ingestion-failures.test.ts`. Supabase is mocked at the `@/lib/supabase/server` boundary (`createSupabaseServerClient` → in-memory thenable query engine); `next/link` → plain `<a>`; `SiteHeader`/`SiteFooter` stubbed to null; `@/features/auth` `useAuth` → signed-out, so pages render the signed-out path.

Asserts per page (all 10): the page renders (not a loading shell); the tool's heading/copy is present; the `RelatedTools` block is present with links carrying `?product=` (or the tool's own dialect) when a product is selected; the honest empty states render — T7's "Not recorded yet" state, T3's "Not recorded yet" stores, T10's "Unknown" verdict (never "Exact"), T9's "no refurbished offer" stance. `invalidateCache('smartbuy:')` runs in `beforeEach` so one warm SWR entry cannot mask the next test's seed.

**Per-tool split of the 31 tests was not recorded in the stage report** — the file covers all 10 pages; do not quote a per-tool number for this layer.

### Layer 6 — Transfer: selection survives tool → tool (Stage 6)

**File:** `tests/cross-tool-transfer.test.ts` — **27/27 pass.**

Asserts: a product selected in one tool is available in the next via the URL (selection survives tool → tool); cached fetch dedupes the second call; param-dialect translation round-trips (e.g. `?product=` → `?device=` → `?current=` and back to the same slug).

**Design correction, documented in the test file header:** the service-mock counting pattern cannot prove `getToolProduct` dedup — the cache lives *inside* `getCachedProductBySlug`, so mocking that delegate replaces the cache itself and two calls legitimately call it twice (the same intra-module caveat Stage 3 documents for price-history/commerce). The first draft of that test failed exactly this way; it was removed, not worked around. Dedup is proven at the fake-client boundary for the transfer paths instead.

## 3. Regression — the refactor stages

Stage 2 was pure refactor (behaviour pinned by existing tests first). Its stage gates:

| Stage | Gate |
|---|---|
| Stage 0 (docs + open checks) | tsc 0; affected tests **68/68** (price-match 18, trust-metadata 23, chunk8 17, a11y-runtime 10) |
| Stage 1 | tsc 0; `tool-integration` 32/32 (see §2 Layer 1) |
| Stage 2a (S2-1–S2-4) | tsc 0; S2-1 affected tests pass (incl. `compare-pricing` 10, `currency-converter` 11 — output-identity proof); persona-fit 18 (17 unchanged + 1 new table assertion); own-it-check **23/23 unchanged** (no test edited); pipeline suites **156/156** |
| Stage 2b (S2-5–S2-7) | tsc 0; S2-5: **58/58** (5 files); S2-6a: 116/117 at gate time — the 1 failure was the pre-existing date-sensitive failure in `final100-verification-spine.test.ts`, fixed in Stage 2 cleanup (see below); S2-6b: **155/155** (5 files) |
| Stage 2 cleanup | tsc 0; own-it-check 23/23; pipeline suites 129/129 (3 files); `final100-verification-spine` **71/71** (was 70/71 — the midnight-flip failure fixed); monitoring suite 50/50; **165/165** (13 files, S2-7) |
| Stages 0–2 full gate | Serial suite **333 files / 4,559 tests passed, 4 skipped, 0 failed**; a11y 33/33; lint 0; clean build exit 0; press counts re-locked 4,559/333 at that point |
| Stage 3 | tsc 0; wiring tests 75/75; affected tests **255/255**; eslint 0 on all 17 touched files; incremental build exit 0 (full suite deferred to the coordinator's gate, per task) |
| Stage 4 | tsc 0; shopping-decision 11/11 (full suite deferred to the coordinator's gate, per task) |
| Stage 5 | tsc 0; guided-journey 22/22; affected tests **158/158**; eslint 0 on all 4 touched files (full suite / a11y deferred to the coordinator's gate, per task) |
| Stage 6 (final) | tsc 0; serial suite **338 / 4,725 / 4 skipped / 0 failed** (run twice, identical); a11y 33/33; lint 0; clean build exit 0; press counts re-locked 4,725/338 |

Two source-assertion tests were updated in Stage 2a (same outcome, asserted via the shared path instead of the literal): `tests/section10-polish.test.ts` and `tests/sitemap-timeout.test.ts` — both previously asserted the literal `.neq('slug', 'sample-laptop')` in source; both now assert `EXCLUDED_SLUGS` usage. The mock-based test `tests/products-sample-exclusion.test.ts` passes UNCHANGED.

## 4. What is NOT covered by tests (honest gaps)

- **Live behaviour is not covered by the suite.** The vitest suite runs against mocked Supabase; the live proof is the recheck (15:25 PKT, 7/7 PASS), not a test. In particular: real Supabase reads, real Vercel deployment, real auth, and real cron firing are never asserted by any test.
- **T7's activation is untestable in this tree:** no test can assert repairability scores appearing, because migration 019 is unapplied and the columns do not exist. The tests assert the empty state, not the populated state.
- **The per-tool split of the 31 page/render tests is not recorded** (see Layer 5).
- **Mobile/responsive is unproven** (no viewport export, no mobile test — pre-existing gap, `docs/responsive-qa.md` is code-inspection only).
- **The 4 skipped tests** are the pre-existing RLS execution tests (need `S18_RLS_DATABASE_URL` + `pg` — owner-gated, O-16). They skip, they do not fail.
- **Parallel-run flake — second occurrence, identity still unknown (Stage 6 + Phase 11 gate):** the first parallel `check:press-counts` run in the Phase 11 gate (2026-11-14) exited 1 at 4,724 tests / 337 files — exactly one test file short of the serial run's 4,725/338 — and the check script discards vitest's output, so the failing file's name is again lost. A full-output parallel re-run the same day passed clean (338 files / 4,725 tests, exit 0), as did the serial gate (4,725/338) and a `check:press-counts` re-run (exit 0, committed JSON 4,725/338 confirmed fresh). Count across both occurrences: the flake has appeared only in parallel runs, never in the serial gate, and every re-run has been green. The serial gate (the authority) never failed. If it ever reproduces with a name, fix that test; until then, treat a lone parallel failure as a flake only after a green re-run — never by assumption.
- **Third parallel failure (Post-Integration gate, 2026-11-14) — NOT a flake, cause identified:** after `npm run generate:press-counts` re-locked the JSON to 4,782/341, the `check:press-counts` re-run failed at 4,781 tests / 340 files, exit 1. A full-output parallel re-run reproduced it with a name: `tests/press-counts-json.test.ts` — its pinned baseline still asserted the old 4,725/338. The JSON had been regenerated without updating the baseline in the same change (the test's own comment requires both). Fixed by updating the baseline to 4,782/341 in the same change; the serial gate was re-run on the final tree afterwards. Lesson: a "one file short" parallel result is not automatically the flake — check for a named failure first.

## 5. How to re-run

```bash
cd ~/workspace/shahjahanaibuy
npx tsc --noEmit                                  # 0 errors
npm run test:ci-log                               # full serial suite (scripts/run-tests-with-log.mjs)
npm run test:a11y                                 # 33/33
npm run lint                                      # 0
rm -rf .next && NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
  NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key npm run build   # exit 0
```

Integration layers only: `npx vitest run tests/tool-integration.test.ts tests/tool-integration-wiring.test.ts tests/shopping-decision.test.ts tests/guided-journey.test.ts tests/tool-pages.test.ts tests/cross-tool-transfer.test.ts` — **198 tests** (32 + 75 + 11 + 22 + 31 + 27), all passing on the final tree.
