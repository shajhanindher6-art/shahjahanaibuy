# Price-history retention policy (FINAL 100%, W3 — F-P2-24)

## Policy

`price_history` is **append-only by design** (migration 002 header: "never updated or deleted").
A row is an observation of a price at a moment in time; deleting one rewrites what was
observed. No code in this repo UPDATEs or DELETEs a `price_history` row.

- **Retention: indefinite** until the owner decides otherwise. At 40 rows today the table
  is tiny, and growth is one row per (product, retailer) price change — unbounded retention
  is not a storage risk at this scale.
- **No pruning job runs.** There is no scheduled deletion, no TTL, and no background
  cleanup of `price_history`.
- **No rows were deleted to "fix" anything.** The audit found 0 duplicates and 0 invalid
  rows; retention is a policy gap (undocumented), not a data gap.

## Archival (future, owner-approved only)

Rows older than **5 years** are archival *candidates* — for **copying** to cold storage
(an export), never for moving or deleting. Archival execution needs all of:

1. Explicit owner approval, recorded (who approved, when, which rows).
2. Migration 070 applied first — the cleanup/quarantine audit table that records every
   removed row. No deletion happens before that table exists.
3. Copy to cold storage verified before any live-table removal, and removal as a separate,
   audited step — never bundled into a plan.

The code half lives in `services/price-history-retention.ts`:
`getPriceHistoryRetentionPolicy()` returns the policy as data, and
`planPriceHistoryArchival(rows)` returns a plan only — candidates, `deletes: 0` (typed as
the literal `0`, so no future edit can silently turn a plan into a deletion), and the
owner action required. There is deliberately **no `executeArchival` function**: a plan is
not an execution, and nothing in this repo can delete a history row.

## Related owner-gated items

- **Migration 045** (price-history UNIQUE index) — duplicate prevention at the DB level;
  apply per the runbook. It stops a double-run race, not a genuinely re-recorded price.
- **Migration 057** (source / observed_at / suspicious_change) — provenance for each row.
- **Migration 070** (cleanup/quarantine audit table, files only — another worker's scope) —
  precondition for ANY future deletion.
- **F-P1-14 note**: `products.data_freshness` is `NOT NULL DEFAULT now()` (migration 002).
  Code passes explicit freshness from intake evidence only
  (`services/intake-evidence.ts` — eBay preview time, nothing for manual rows), but the DB
  default still stamps on create. Removing that default is a migration change, owner-gated.
