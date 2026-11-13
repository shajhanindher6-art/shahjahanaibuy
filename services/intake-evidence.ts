/**
 * FINAL 100% Product & Real Data Completion — Worker W3 (F-P1-13, F-P1-14).
 *
 * What manual/CSV intake may and may not assert.
 *
 * Availability (F-P1-13): neither the CSV nor the eBay preview
 * carries an availability value — no source supplies it. The old
 * intake approve hardcoded `availability: 'in_stock'` on every
 * listing, asserting stock nobody observed. Intake now records
 * 'unknown' unless the source supplied a real availability value.
 * The `in_stock` boolean on merchant_products is NOT NULL, so it
 * cannot express "unknown"; it stays true so the listing remains
 * visible to the price lookup (services/products.ts filters
 * in_stock = true) — the `availability` text column is the source
 * of truth, and the boolean's limitation is recorded here, not
 * hidden. A migration that makes in_stock nullable is the
 * follow-up; no code here invents stock either way.
 *
 * Freshness (F-P1-14): `products.data_freshness` is
 * `NOT NULL DEFAULT now()` (migration 002), so a manual-intake
 * row that sets no freshness is stamped with its approve time and
 * reads as "last validated <approve date>" though nothing was
 * ever validated. Code must pass explicit freshness from intake
 * evidence only: the eBay preview fetch time when the batch
 * carries one, NOTHING otherwise (the column is omitted and the
 * DB default still stamps — only a migration can remove that
 * default; see docs/price-history-retention.md's owner-action
 * note and the migration worker's 068–071 scope). Returning null
 * is the honest signal: "no check date exists for this row" —
 * readers must treat such a row's freshness as unattributed, and
 * the approve response + audit log now say so instead of letting
 * the DB default pass as a validation date.
 */

import { availabilitySchema } from '@/services/pipeline/validation';
import { EBAY_INTAKE_SOURCE } from '@/services/ebay-intake';

/** Availability values a source may supply (pipeline enum). */
export type IntakeAvailability = 'in_stock' | 'out_of_stock' | 'limited' | 'preorder' | 'unknown';

/**
 * Resolve the availability to record for an intake listing.
 * Only a value the source actually supplied is recorded; anything
 * else — missing, blank, or not in the enum — is 'unknown'.
 * Never returns 'in_stock' by default.
 */
export function resolveIntakeAvailability(
  supplied?: string | null
): IntakeAvailability {
  if (typeof supplied === 'string' && supplied.trim() !== '') {
    const parsed = availabilitySchema.safeParse(supplied.trim());
    if (parsed.success) return parsed.data;
  }
  return 'unknown';
}

/**
 * Resolve the explicit data_freshness to stamp on an intake
 * product row, from intake evidence only.
 * - eBay source + a parseable preview fetch time → that time
 *   (the check time, never the approve time).
 * - anything else (manual intake, or eBay without a carried
 *   preview time) → null: no check date exists, stamp nothing.
 * Callers omit the column when this returns null. The DB default
 * (`now()`, migration 002) still stamps on create — that default
 * can only be removed by a migration (owner-gated); null here
 * means "no evidence", and the approve response/audit log must
 * say the freshness is unattributed rather than letting the
 * default read as a validation date.
 */
export function resolveIntakeDataFreshness(
  source: string,
  fetchedAt?: string | null
): string | null {
  if (source !== EBAY_INTAKE_SOURCE) return null;
  if (typeof fetchedAt !== 'string' || !fetchedAt.trim()) return null;
  const time = new Date(fetchedAt).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/** True when an intake batch's freshness stamp is a real check date. */
export function intakeFreshnessIsCheckDate(source: string, checkedAt: string | null): boolean {
  return source === EBAY_INTAKE_SOURCE && checkedAt !== null;
}
