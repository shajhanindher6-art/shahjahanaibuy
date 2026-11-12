/**
 * Owner dashboard service (Section 17, Stage H item 19).
 *
 * Aggregates the numbers the owner needs — revenue, subscriptions,
 * API usage, price-source health, failed jobs, error logs — from
 * existing tables/services only. Nothing here invents data:
 *
 * - Revenue is $0 by construction. Stripe is in test mode and no paid
 *   plan can be bought today (see lib/tiers.ts: every paid tier is
 *   priceStatus 'planned'), so no live charge has ever been taken.
 *   The page states $0 and why; it never multiplies a plan price by
 *   a subscriber count and calls that revenue.
 * - Every section is fail-open: a missing table (migration not
 *   applied yet — 032 uptime, 035 API usage, 040 refresh runs) or a
 *   missing service-role key renders an honest "not available yet"
 *   state, never a zero presented as a measurement.
 * - Error logs: there is NO error-log table or service in the repo
 *   (verified by grep, 12 Nov 2026) — the page says so and points at
 *   the Vercel logs instead of showing an empty table as if it were
 *   a clean bill of health.
 *
 * Structure follows services/admin.ts + services/affiliate-analytics.ts:
 * getOwnerOverview() fetches (service-role client, server only) and
 * buildOwnerOverview() is the pure aggregation, unit-tested without
 * a database.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import type { RefreshRunRow } from '@/services/refresh-run';

export interface OwnerSubscriptionCounts {
  /** Null when the subscriptions table could not be read. */
  total: number | null;
  active: number | null;
  /** Active subscriptions on a paid plan (never a revenue figure). */
  activePaid: number | null;
  byPlan: Record<string, number>;
  tableMissing: boolean;
}

export interface OwnerApiUsage {
  totalKeys: number | null;
  /** API calls recorded in the last 7 days, or null when unrecorded. */
  callsLast7Days: number | null;
  /** True when the api_key_usage table does not exist yet (035). */
  tableMissing: boolean;
}

export interface OwnerPriceSourceHealth {
  totalProducts: number | null;
  totalMerchants: number | null;
  /** Latest recorded data_freshness stamp across products, or null. */
  latestFreshness: string | null;
  tableMissing: boolean;
}

export interface OwnerRefreshHealth {
  latestRun: RefreshRunRow | null;
  recentRuns: RefreshRunRow[];
  /** Failed step names in the latest run (empty when it was clean). */
  latestFailedSteps: string[];
  /** True when the price_refresh_runs table does not exist yet (040). */
  tableMissing: boolean;
}

export interface OwnerUptimeHealth {
  totalChecks: number | null;
  lastCheckAt: string | null;
  lastCheckOk: boolean | null;
  /** True when the uptime_checks table does not exist yet (032). */
  tableMissing: boolean;
}

export interface OwnerOverview {
  subscriptions: OwnerSubscriptionCounts;
  apiUsage: OwnerApiUsage;
  priceSourceHealth: OwnerPriceSourceHealth;
  refreshHealth: OwnerRefreshHealth;
  uptimeHealth: OwnerUptimeHealth;
  /** Revenue is $0 — Stripe is in test mode; see the page copy. */
  revenueUsd: 0;
  /** There is no error-log store in the repo — the page says so. */
  errorLogsAvailable: false;
}

export interface OwnerOverviewInput {
  subscriptionRows: Array<{ plan: string; status: string }> | null;
  totalApiKeys: number | null;
  apiCallsLast7Days: number | null;
  apiUsageTableMissing: boolean;
  totalProducts: number | null;
  totalMerchants: number | null;
  latestFreshness: string | null;
  catalogTableMissing: boolean;
  refreshRuns: RefreshRunRow[] | null;
  refreshRunsTableMissing: boolean;
  totalUptimeChecks: number | null;
  latestUptimeCheck: { checked_at: string; ok: boolean } | null;
  uptimeTableMissing: boolean;
}

const EMPTY_OVERVIEW_INPUT: OwnerOverviewInput = {
  subscriptionRows: null,
  totalApiKeys: null,
  apiCallsLast7Days: null,
  apiUsageTableMissing: true,
  totalProducts: null,
  totalMerchants: null,
  latestFreshness: null,
  catalogTableMissing: true,
  refreshRuns: null,
  refreshRunsTableMissing: true,
  totalUptimeChecks: null,
  latestUptimeCheck: null,
  uptimeTableMissing: true,
};

/** Pure aggregation: rows/counts in, view model out. No I/O. */
export function buildOwnerOverview(input: OwnerOverviewInput): OwnerOverview {
  const byPlan: Record<string, number> = {};
  let active = 0;
  let activePaid = 0;
  for (const row of input.subscriptionRows ?? []) {
    byPlan[row.plan] = (byPlan[row.plan] ?? 0) + 1;
    if (row.status === 'active') {
      active += 1;
      if (row.plan !== 'free') activePaid += 1;
    }
  }

  const latestRun = input.refreshRuns?.[0] ?? null;
  const latestFailedSteps = latestRun
    ? Object.entries(latestRun.steps ?? {})
        .filter(([, step]) => step.status === 'failed')
        .map(([name]) => name)
    : [];

  return {
    subscriptions: {
      total: input.subscriptionRows ? input.subscriptionRows.length : null,
      active: input.subscriptionRows ? active : null,
      activePaid: input.subscriptionRows ? activePaid : null,
      byPlan,
      tableMissing: input.subscriptionRows === null,
    },
    apiUsage: {
      totalKeys: input.totalApiKeys,
      callsLast7Days: input.apiCallsLast7Days,
      tableMissing: input.apiUsageTableMissing,
    },
    priceSourceHealth: {
      totalProducts: input.totalProducts,
      totalMerchants: input.totalMerchants,
      latestFreshness: input.latestFreshness,
      tableMissing: input.catalogTableMissing,
    },
    refreshHealth: {
      latestRun,
      recentRuns: input.refreshRuns ?? [],
      latestFailedSteps,
      tableMissing: input.refreshRunsTableMissing,
    },
    uptimeHealth: {
      totalChecks: input.totalUptimeChecks,
      lastCheckAt: input.latestUptimeCheck?.checked_at ?? null,
      lastCheckOk: input.latestUptimeCheck?.ok ?? null,
      tableMissing: input.uptimeTableMissing,
    },
    revenueUsd: 0,
    errorLogsAvailable: false,
  };
}

/** Fetch every section; any failed read degrades to its empty state. */
export async function getOwnerOverview(
  supabase: AnySupabaseClient
): Promise<OwnerOverview> {
  const input: OwnerOverviewInput = { ...EMPTY_OVERVIEW_INPUT };

  try {
    const [subs, keys, usage, products, merchants, freshness, runs, uptimeCount, uptimeLatest] =
      await Promise.all([
        supabase.from('subscriptions').select('plan, status').limit(5000),
        supabase.from('api_keys').select('*', { count: 'exact', head: true }),
        // api_key_usage (035) is a daily ledger: one row per
        // (key_hash, window_date) with a request_count — there is no
        // created_at column. Sum the last 7 windows client-side.
        supabase
          .from('api_key_usage')
          .select('request_count')
          .gte(
            'window_date',
            new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
          ),
        supabase.from('products').select('*', { count: 'exact', head: true }).is('deleted_at', null),
        supabase.from('merchants').select('*', { count: 'exact', head: true }),
        supabase
          .from('products')
          .select('data_freshness')
          .not('data_freshness', 'is', null)
          .order('data_freshness', { ascending: false })
          .limit(1),
        supabase
          .from('price_refresh_runs')
          .select('id, source, started_at, finished_at, status, steps, error')
          .order('started_at', { ascending: false })
          .limit(5),
        supabase.from('uptime_checks').select('*', { count: 'exact', head: true }),
        supabase
          .from('uptime_checks')
          .select('checked_at, ok')
          .order('checked_at', { ascending: false })
          .limit(1),
      ]);

    if (!subs.error && subs.data) {
      input.subscriptionRows = subs.data as Array<{ plan: string; status: string }>;
    } else if (subs.error) {
      logger.warn('getOwnerOverview: subscriptions read failed', { error: subs.error.message });
    }
    if (!keys.error) input.totalApiKeys = keys.count ?? 0;
    if (!usage.error) {
      input.apiCallsLast7Days = ((usage.data ?? []) as Array<{ request_count: number }>).reduce(
        (sum, row) => sum + (row.request_count ?? 0),
        0
      );
      input.apiUsageTableMissing = false;
    }
    if (!products.error) {
      input.totalProducts = products.count ?? 0;
      input.catalogTableMissing = false;
    }
    if (!merchants.error) input.totalMerchants = merchants.count ?? 0;
    if (!freshness.error && freshness.data?.[0]) {
      input.latestFreshness = (freshness.data[0] as { data_freshness: string }).data_freshness;
    }
    if (!runs.error && runs.data) {
      input.refreshRuns = runs.data as unknown as RefreshRunRow[];
      input.refreshRunsTableMissing = false;
    } else if (runs.error) {
      logger.warn('getOwnerOverview: refresh runs read failed', { error: runs.error.message });
    }
    if (!uptimeCount.error) {
      input.totalUptimeChecks = uptimeCount.count ?? 0;
      input.uptimeTableMissing = false;
    }
    if (!uptimeLatest.error && uptimeLatest.data?.[0]) {
      input.latestUptimeCheck = uptimeLatest.data[0] as { checked_at: string; ok: boolean };
    }
  } catch (err) {
    logger.error('getOwnerOverview: unexpected error', { error: String(err) });
  }

  return buildOwnerOverview(input);
}
