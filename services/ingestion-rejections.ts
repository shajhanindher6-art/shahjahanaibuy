/**
 * Section 21–25, Stage C (B5) — persist pipeline / CSV rejections.
 *
 * A rejected row used to leave no record: the pipeline logged it
 * and returned the error to the caller, and the CSV review kept
 * the error only in the preview response. The admin therefore had
 * no import-failure trail to review. Rejections are now persisted
 * into the `error_log` store (migration 048) — the same store the
 * /admin/ingestion-failures page already reads — with
 * `route = 'catalog-ingestion'` and the row + reason in `meta`,
 * so the failures page can list them alongside refresh failures.
 *
 * Store contract (same as services/error-log-admin.ts): migration
 * 048 unapplied → the table does not exist and the write returns
 * 'missing-table' instead of throwing. `recordIngestionRejection`
 * NEVER throws and never blocks the caller's rejection — a
 * rejection that cannot be stored is still a rejection, and the
 * caller logs it at debug level and moves on.
 *
 * `buildRejectionRecords` is the pure half for the CSV review:
 * `reviewIntakeRows` is pure by design (it reads nothing, writes
 * nothing), so it cannot persist anything itself — the intake
 * route turns its review into records with this helper and calls
 * `recordIngestionRejection` for each. Nothing here invents a
 * row: a record carries the CSV row number, the raw row values
 * the admin supplied, and the exact validation reason.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { insertErrorLogRow, type InsertErrorLogOutcome } from '@/services/error-log-admin';
import type { IntakeReview, IntakeRowInput } from '@/services/catalog-intake';

export const INGESTION_REJECTION_ROUTE = 'catalog-ingestion';

/** One rejected row, as stored (row + reason + timestamp). */
export interface IngestionRejectionRecord {
  /** Where the rejection came from: 'pipeline' | 'csv-intake' | 'ebay-intake'. */
  source: 'pipeline' | 'csv-intake' | 'ebay-intake';
  /** CSV row number (1-based, header is 1) when known. */
  rowNumber: number | null;
  /** Product name as supplied, when known. */
  productName: string | null;
  /** The rejected row's identifying values (never a full raw dump). */
  row: Record<string, unknown>;
  /** Exact reason the row was rejected. */
  reason: string;
  /** ISO timestamp the rejection was recorded. */
  recordedAt: string;
}

export interface IngestionRejection {
  id: string;
  created_at: string;
  message: string;
  productName: string | null;
  source: string | null;
  rowNumber: number | null;
  reason: string | null;
  row: Record<string, unknown> | null;
}

export interface ListIngestionRejectionsResult {
  rejections: IngestionRejection[];
  /** True when the error_log table does not exist yet (048 unapplied). */
  tableMissing: boolean;
  error?: string;
}

/**
 * Persist one rejection. Returns the store outcome
 * ('inserted' | 'missing-table' | 'failed'). Never throws.
 */
export async function recordIngestionRejection(
  supabase: AnySupabaseClient,
  record: Omit<IngestionRejectionRecord, 'recordedAt'> & { recordedAt?: string }
): Promise<InsertErrorLogOutcome> {
  const recordedAt = record.recordedAt ?? new Date().toISOString();
  try {
    const outcome = await insertErrorLogRow(supabase, {
      level: 'warn',
      message: `Ingestion rejected (${record.source}): ${record.reason}`,
      route: INGESTION_REJECTION_ROUTE,
      meta: {
        source: record.source,
        rowNumber: record.rowNumber,
        productName: record.productName,
        row: record.row,
        reason: record.reason,
        recordedAt,
      },
    });
    if (outcome !== 'inserted') {
      logger.debug('recordIngestionRejection: rejection not stored', { outcome });
    }
    return outcome;
  } catch (err) {
    logger.debug('recordIngestionRejection: failed', { error: String(err) });
    return 'failed';
  }
}

/**
 * Build rejection records from a CSV/eBay intake review: every
 * 'error' row becomes one record (row number + supplied values +
 * the exact validation reasons). 'duplicate' / 'near-duplicate'
 * rows are NOT rejections — they are held for review, not
 * rejected — so they produce no record. Pure: reads nothing,
 * writes nothing.
 */
export function buildRejectionRecords(
  review: IntakeReview,
  rows: IntakeRowInput[],
  source: 'csv-intake' | 'ebay-intake'
): IngestionRejectionRecord[] {
  const inputByRow = new Map(rows.map((row) => [row.rowNumber, row]));
  const recordedAt = new Date().toISOString();
  const records: IngestionRejectionRecord[] = [];
  for (const reviewed of review.rows) {
    if (reviewed.status !== 'error') continue;
    const input = inputByRow.get(reviewed.rowNumber);
    records.push({
      source,
      rowNumber: reviewed.rowNumber,
      productName: input?.name?.trim() ? input.name.trim() : null,
      row: input
        ? {
            name: input.name || null,
            slug: input.slug || null,
            brand: input.brand || null,
            category: input.category || null,
            price: input.price || null,
            currency: input.currency || null,
            merchant: input.merchant || null,
            gtin: input.gtin || null,
          }
        : {},
      reason: reviewed.errors.map((e) => `${e.field}: ${e.reason}`).join('; '),
      recordedAt,
    });
  }
  return records;
}

/**
 * Most recent ingestion rejections, newest first — for the
 * /admin/ingestion-failures page. Same missing-table contract as
 * listRecentErrors: 048 unapplied → `{ tableMissing: true }`.
 */
export async function listIngestionRejections(
  supabase: AnySupabaseClient,
  limit = 50
): Promise<ListIngestionRejectionsResult> {
  try {
    const { data, error } = await supabase
      .from('error_log')
      .select('id, created_at, message, meta')
      .eq('route', INGESTION_REJECTION_ROUTE)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205') {
        return { rejections: [], tableMissing: true };
      }
      return {
        rejections: [],
        tableMissing: false,
        error: error.message ?? 'Ingestion rejections could not be read.',
      };
    }
    const rejections: IngestionRejection[] = (
      (data ?? []) as unknown as Array<{
        id: string;
        created_at: string;
        message: string;
        meta: Record<string, unknown> | null;
      }>
    ).map((row) => ({
      id: row.id,
      created_at: row.created_at,
      message: row.message,
      productName:
        typeof row.meta?.productName === 'string' ? (row.meta.productName as string) : null,
      source: typeof row.meta?.source === 'string' ? (row.meta.source as string) : null,
      rowNumber: typeof row.meta?.rowNumber === 'number' ? (row.meta.rowNumber as number) : null,
      reason: typeof row.meta?.reason === 'string' ? (row.meta.reason as string) : null,
      row:
        row.meta?.row && typeof row.meta.row === 'object'
          ? (row.meta.row as Record<string, unknown>)
          : null,
    }));
    return { rejections, tableMissing: false };
  } catch (err) {
    return {
      rejections: [],
      tableMissing: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
