/**
 * FINAL 100% Product & Real Data Completion — Worker W3 (F-P2-24).
 *
 * Price-history retention policy — as code, so the policy is
 * testable and the "no deletion" rule is enforced by construction.
 *
 * Policy (the whole of it):
 * - `price_history` is APPEND-ONLY by design (migration 002
 *   header: "never updated or deleted"). Rows are observations;
 *   deleting one rewrites what was observed. No code in this repo
 *   UPDATEs or DELETEs a price_history row, and none may be added
 *   without the owner action below.
 * - Retention is INDEFINITE until the owner decides otherwise.
 *   At 40 rows today the table is tiny; growth is one row per
 *   (product, retailer) price change, so unbounded retention is
 *   not a storage risk at this scale. No pruning job runs, and no
 *   scheduled deletion exists.
 * - Archival is a FUTURE, owner-approved operation only: rows
 *   older than the archival window may be COPIED to cold storage
 *   (an export, never a move) and only then, with explicit owner
 *   approval recorded, removed from the live table — and only
 *   after migration 070's audit table exists to record every
 *   removed row. There is deliberately NO `executeArchival` /
 *   delete function in this module: `planPriceHistoryArchival`
 *   returns a plan and nothing else. A plan is not an execution.
 *
 * The human-readable policy lives in docs/price-history-retention.md.
 */

export interface PriceHistoryRetentionPolicy {
  /** Append-only: rows are never updated or deleted by code. */
  appendOnly: true;
  /** Indefinite until the owner sets a window. */
  retention: 'indefinite';
  /** Rows older than this are archival candidates (never auto-deleted). */
  archivalWindowDays: number;
  /** Archival always needs explicit owner approval, recorded. */
  requiresOwnerApproval: true;
  /** Deletion needs migration 070's audit table first. */
  requiresAuditTableBeforeAnyDeletion: true;
}

/** The retention policy, as data. */
export function getPriceHistoryRetentionPolicy(): PriceHistoryRetentionPolicy {
  return {
    appendOnly: true,
    retention: 'indefinite',
    archivalWindowDays: 5 * 365,
    requiresOwnerApproval: true,
    requiresAuditTableBeforeAnyDeletion: true,
  };
}

export interface ArchivalCandidate {
  id: string;
  productId: string;
  recordedAt: string;
  ageDays: number;
}

export interface PriceHistoryArchivalPlan {
  /** Rows older than the archival window (candidates for COPY to cold storage). */
  candidates: ArchivalCandidate[];
  /**
   * Rows this plan would DELETE from the live table: always 0.
   * A plan never deletes; deletion needs a separate owner-approved
   * execution after the audit table (070) exists.
   */
  deletes: 0;
  requiresOwnerApproval: true;
  /** What the owner must do before any archival execution. */
  ownerActionRequired: string;
}

/**
 * Plan (never execute) archival for a set of history rows: rows
 * older than the archival window are candidates for copying to
 * cold storage. Pure — reads the rows the caller supplies, writes
 * nothing, deletes nothing. `deletes` is typed as the literal 0
 * so no future edit can silently turn a plan into a deletion.
 */
export function planPriceHistoryArchival(
  rows: ReadonlyArray<{ id: string; productId: string; recordedAt: string } | null | undefined>,
  now: Date = new Date()
): PriceHistoryArchivalPlan {
  const { archivalWindowDays } = getPriceHistoryRetentionPolicy();
  const candidates: ArchivalCandidate[] = [];
  for (const row of rows ?? []) {
    if (!row || !row.recordedAt) continue;
    const ms = new Date(row.recordedAt).getTime();
    if (!Number.isFinite(ms)) continue;
    const ageDays = Math.floor((now.getTime() - ms) / 86_400_000);
    if (ageDays > archivalWindowDays) {
      candidates.push({ id: row.id, productId: row.productId, recordedAt: row.recordedAt, ageDays });
    }
  }
  return {
    candidates,
    deletes: 0,
    requiresOwnerApproval: true,
    ownerActionRequired:
      'Owner approval, recorded, plus migration 070 (cleanup/quarantine audit table) applied, before any row is removed from the live table. Copy to cold storage first; deletion is a separate, audited step — never part of a plan.',
  };
}
