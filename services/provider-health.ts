/**
 * FINAL 100% — provider health writers + "never synced" reader
 * (F-P2-04 code part).
 *
 * The gap (audit Worker C C-P2-1): provider health was never
 * written in substance for merchant sources — only eBay wrote,
 * only on checked>0 / 'unavailable'; `data_sources.last_sync_*`
 * had no writer on any live path. `recordDataSourceSync`
 * (services/data-sources.ts) existed as the writer, but almost
 * nothing called it.
 *
 * This module is the single health-write entry point every
 * provider path must call after a real attempt:
 * - `recordProviderHealthAttempt`: writes BOTH trails,
 *   best-effort, never throws, never fails the sync that called
 *   it — `data_sources.last_sync_*` (via recordDataSourceSync)
 *   AND `provider_health` (via reportAiProviderHealth). A
 *   missing `providers` row / missing table degrades to
 *   'skipped' with a warn log; the attempt is still reported in
 *   the return value so the caller can say so honestly.
 * - `getProviderLastSync`: the reader — last sync time, status,
 *   and error for one provider, or `neverSynced: true` when no
 *   writer has ever run for it. "Never synced" is a first-class
 *   answer, never a null presented as a date.
 *
 * Wired today: eBay refresh (services/ebay-refresh.ts — every
 * outcome, success AND failure). Best Buy / Amazon have no live
 * call path to write from (no client exists), and CSV writes via
 * the job processors' existing recordDataSourceSync calls — so
 * for those providers the reader honestly returns "never
 * synced" until a real call path exists. That is the design, not
 * a gap to paper over.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { ensureProviderDataSource, recordDataSourceSync } from './data-sources';
import { reportAiProviderHealth } from './ai-engine/health-report';

export type ProviderHealthOutcome = 'success' | 'failed';

export interface ProviderHealthAttempt {
  providerKey: string;
  outcome: ProviderHealthOutcome;
  /** Plain-language reason (never a secret). Shown on failure. */
  error?: string;
  /** Rows fetched / products checked in this attempt (0 when unknown). */
  recordsChecked?: number;
  /** How long the attempt took, ms. */
  responseMs?: number;
  /**
   * When false, only the `data_sources` trail is written — the
   * `provider_health` trail keeps its existing semantics (config
   * states like 'not-configured' / 'merchant-missing' are not
   * provider failures and are not recorded there). Defaults true.
   */
  includeProviderHealth?: boolean;
}

export interface ProviderHealthWriteResult {
  /** 'updated' when at least one trail was written. */
  dataSources: 'updated' | 'skipped';
  providerHealth: 'reported' | 'skipped';
}

/**
 * Record one provider attempt on both health trails. Best-effort
 * and never throws: a missing providers row, a missing table, or
 * any DB error returns 'skipped' for that trail with a warn log.
 * The `data_sources` row is ensured first (otherwise
 * recordDataSourceSync updates zero rows and the write silently
 * goes nowhere).
 */
export async function recordProviderHealthAttempt(
  supabase: AnySupabaseClient,
  attempt: ProviderHealthAttempt
): Promise<ProviderHealthWriteResult> {
  let dataSources: ProviderHealthWriteResult['dataSources'] = 'skipped';
  let providerHealth: ProviderHealthWriteResult['providerHealth'] = 'skipped';
  try {
    await ensureProviderDataSource(supabase, { providerKey: attempt.providerKey });
    dataSources = await recordDataSourceSync(supabase, attempt.providerKey, {
      status: attempt.outcome,
      ...(attempt.error ? { error: attempt.error.slice(0, 500) } : {}),
      recordsFetched: attempt.recordsChecked ?? 0,
    });
  } catch (err) {
    logger.warn('recordProviderHealthAttempt: data_sources write failed', {
      provider: attempt.providerKey,
      error: String(err),
    });
  }
  if (attempt.includeProviderHealth === false) {
    return { dataSources, providerHealth };
  }
  try {
    await reportAiProviderHealth(supabase, attempt.providerKey, {
      success: attempt.outcome === 'success',
      responseMs: attempt.responseMs ?? 0,
      ...(attempt.error ? { error: attempt.error.slice(0, 200) } : {}),
    });
    providerHealth = 'reported';
  } catch (err) {
    logger.warn('recordProviderHealthAttempt: provider_health write failed', {
      provider: attempt.providerKey,
      error: String(err),
    });
  }
  return { dataSources, providerHealth };
}

export interface ProviderLastSync {
  providerKey: string;
  /** ISO timestamp of the last recorded sync, or null when never synced. */
  lastSyncAt: string | null;
  lastSyncStatus: 'success' | 'failed' | null;
  lastSyncError: string | null;
  /** True when no writer has ever recorded a sync for this provider. */
  neverSynced: boolean;
  /** True when the data_sources table could not be read at all. */
  tableMissing: boolean;
}

/**
 * Read the last recorded sync for one provider. "Never synced"
 * is returned explicitly when the provider has a row but no sync
 * was ever recorded, or when no row exists at all.
 */
export async function getProviderLastSync(
  supabase: AnySupabaseClient,
  providerKey: string
): Promise<ProviderLastSync> {
  const never: ProviderLastSync = {
    providerKey,
    lastSyncAt: null,
    lastSyncStatus: null,
    lastSyncError: null,
    neverSynced: true,
    tableMissing: false,
  };
  try {
    const { data: provider, error: providerError } = await supabase
      .from('providers')
      .select('id')
      .eq('key', providerKey)
      .maybeSingle();
    if (providerError || !provider) return never;
    const providerId = (provider as { id: string }).id;
    const { data, error } = await supabase
      .from('data_sources')
      .select('last_sync_at, last_sync_status, last_sync_error')
      .eq('provider_id', providerId)
      .maybeSingle();
    if (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === 'PGRST205' || code === '42P01') {
        return { ...never, tableMissing: true };
      }
      logger.warn('getProviderLastSync: read failed', { provider: providerKey, error: error.message });
      return never;
    }
    if (!data) return never;
    const row = data as Record<string, unknown>;
    const lastSyncAt = typeof row.last_sync_at === 'string' ? row.last_sync_at : null;
    return {
      providerKey,
      lastSyncAt,
      lastSyncStatus:
        row.last_sync_status === 'success' || row.last_sync_status === 'failed'
          ? row.last_sync_status
          : null,
      lastSyncError: typeof row.last_sync_error === 'string' ? row.last_sync_error : null,
      neverSynced: lastSyncAt === null,
      tableMissing: false,
    };
  } catch (err) {
    logger.warn('getProviderLastSync: unexpected failure', { provider: providerKey, error: String(err) });
    return never;
  }
}
