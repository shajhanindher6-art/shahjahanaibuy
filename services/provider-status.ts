/**
 * Sections 21–25, Stage B (B2 + B4 + B13) + A10 — the provider-health
 * panel for the admin surface.
 *
 * B2: `getNotConfiguredReason()` was dead code (0 callers). This
 * module is its first real caller: every provider status it
 * reports carries the reason the provider cannot fetch.
 *
 * B13: provider health had no admin UI (API only). The payload
 * built here feeds GET /api/v1/admin/providers and the
 * "Provider health" section of the /admin/ai control center.
 *
 * A10: the canonical merchant-reliability scorer for ADMIN
 * surfaces is `scoreMerchantReliability` / `getMerchantReliability`
 * (services/merchant-reliability.ts) — it scores recorded policy
 * + trust + verified-badge + directory signals, and it already
 * has a production caller (services/ai-comparison.ts). The second
 * scorer, `scoreMerchantSyncReliability`
 * (services/merchant-reliability-score.ts), scores sync freshness
 * and is wired into deal ranking by Stage E
 * (services/ai-deals.ts) — the audit's "zero callers" premise was
 * stale by build time, so NEITHER scorer is deleted. No third
 * scorer was added; the two cover different dimensions (policy
 * vs freshness) and the split is documented in
 * merchant-reliability-score.ts.
 *
 * Fail-safe throughout: a null client, a missing provider_health /
 * sync_history / merchants table, or any failed read degrades to
 * an honest empty state + `tablesMissing` flags, never a 500.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { getProviderRegistry, type DataProvider } from '@/services/providers';
import {
  getProviderHealth,
  getSyncHistory,
  getProviderBreakerState,
  type ProviderBreakerState,
} from '@/services/monitoring';
import {
  getProviderBudgetUsage,
  type ProviderBudgetState,
} from '@/services/provider-budget';
import {
  getMerchantReliability,
  type MerchantReliability,
} from '@/services/merchant-reliability';

export interface ProviderStatusEntry {
  key: string;
  name: string;
  category: string;
  available: boolean;
  /** Plain-language reason the provider cannot fetch, or null when available. (B2) */
  notConfiguredReason: string | null;
  breaker: ProviderBreakerState;
  budget: ProviderBudgetState;
}

export interface ProviderHealthEntry {
  providerKey: string;
  status: string;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  avgResponseMs: number | null;
}

export interface ProviderSyncEntry {
  id: string;
  providerKey: string;
  syncType: string;
  status: string;
  recordsFetched: number;
  recordsInserted: number;
  recordsUpdated: number;
  recordsRejected: number;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface MerchantReliabilityEntry {
  merchantId: string;
  merchantName: string;
  /** 0–100 when enough signals exist; null = not enough data, never a guess. */
  score: number | null;
  level: string;
  verified: boolean | null;
  trustGrade: string | null;
  explanation: string;
  notEnoughData: boolean;
}

export interface ProviderHealthPanel {
  providers: ProviderStatusEntry[];
  health: ProviderHealthEntry[];
  syncHistory: ProviderSyncEntry[];
  merchantReliability: MerchantReliabilityEntry[];
  /** True when the service client was unavailable (no DB reads at all). */
  serviceUnavailable: boolean;
  /** Tables that could not be read (missing/unapplied migrations), by name. */
  tablesMissing: string[];
  generatedAt: string;
}

/** One status entry per registered provider, with its NOT_CONFIGURED reason wired in (B2). */
export function describeProviderStatuses(
  registry: { getAll(): DataProvider[] } = getProviderRegistry()
): ProviderStatusEntry[] {
  return registry.getAll().map((p) => ({
    key: p.key,
    name: p.name,
    category: p.category,
    available: p.isAvailable(),
    notConfiguredReason: p.getNotConfiguredReason(),
    breaker: getProviderBreakerState(p.key),
    budget: getProviderBudgetUsage(p.key),
  }));
}

function toMerchantReliabilityEntry(r: MerchantReliability): MerchantReliabilityEntry {
  return {
    merchantId: r.merchantId,
    merchantName: r.merchantName,
    score: r.score,
    level: r.level,
    verified: r.verified,
    trustGrade: r.trustGrade,
    explanation: r.explanation,
    notEnoughData: r.notEnoughData,
  };
}

function isMissingTableError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'PGRST205' || code === '42P01';
}

/**
 * Build the full provider-health panel. Never throws: every read
 * is guarded, and a missing table is reported in `tablesMissing`
 * (e.g. provider_health / sync_history before their migrations
 * are applied) instead of failing the panel.
 */
export async function getProviderHealthPanel(
  supabase: AnySupabaseClient | null
): Promise<ProviderHealthPanel> {
  const generatedAt = new Date().toISOString();
  const providers = describeProviderStatuses();
  const tablesMissing: string[] = [];

  if (!supabase) {
    return {
      providers,
      health: [],
      syncHistory: [],
      merchantReliability: [],
      serviceUnavailable: true,
      tablesMissing,
      generatedAt,
    };
  }

  let health: ProviderHealthEntry[] = [];
  try {
    health = await getProviderHealth(supabase);
  } catch (err) {
    logger.warn('provider-health panel: provider_health read failed', { error: String(err) });
    if (isMissingTableError(err)) tablesMissing.push('provider_health');
  }

  let syncHistory: ProviderSyncEntry[] = [];
  try {
    syncHistory = await getSyncHistory(supabase, 10);
  } catch (err) {
    logger.warn('provider-health panel: sync_history read failed', { error: String(err) });
    if (isMissingTableError(err)) tablesMissing.push('sync_history');
  }

  // A10 — canonical merchant-reliability scorer, wired into the
  // admin surface. Fail-safe: a failed merchants read yields an
  // empty list, never a crash.
  let merchantReliability: MerchantReliabilityEntry[] = [];
  try {
    const { data, error } = await supabase
      .from('merchants')
      .select('id, name, website_url, active')
      .order('name')
      .limit(50);
    if (error) {
      if (isMissingTableError(error)) tablesMissing.push('merchants');
      logger.warn('provider-health panel: merchants read failed', { error: error.message });
    } else {
      const rows = (data ?? []) as Array<{
        id: string;
        name: string;
        website_url: string | null;
        active: boolean;
      }>;
      const scored: MerchantReliabilityEntry[] = [];
      for (const row of rows) {
        try {
          scored.push(
            toMerchantReliabilityEntry(
              await getMerchantReliability(supabase, {
                id: row.id,
                name: row.name,
                websiteUrl: row.website_url,
                active: row.active !== false,
              })
            )
          );
        } catch (err) {
          logger.warn('provider-health panel: merchant reliability failed', {
            merchant: row.id,
            error: String(err),
          });
        }
      }
      merchantReliability = scored;
    }
  } catch (err) {
    logger.warn('provider-health panel: merchants read threw', { error: String(err) });
  }

  return {
    providers,
    health,
    syncHistory,
    merchantReliability,
    serviceUnavailable: false,
    tablesMissing,
    generatedAt,
  };
}
