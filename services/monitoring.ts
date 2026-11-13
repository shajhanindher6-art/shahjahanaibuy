/**
 * Monitoring service — records and retrieves health metrics for the
 * admin monitoring dashboard.
 *
 * Tracks: provider health, sync history, queue metrics, cache metrics.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';

// ---------------------------------------------------------------------------
// Circuit breaker — in-memory read side (Sections 21–25, Stage B, B3)
// ---------------------------------------------------------------------------
//
// `recordProviderHealth` opened the breaker at ≥5 consecutive
// failures — but nothing ever READ it before calling a provider,
// so the breaker was write-only. This in-memory mirror is updated
// by every `recordProviderHealth` call (success resets it, failure
// increments it) and read by the provider call guard BEFORE any
// provider is contacted. The DB row stays the durable record; this
// map is the live gate. It is per-instance, like the repo's other
// in-memory counters — stated, not hidden.
//
// Half-open: once open, the breaker stays open for 60s, then one
// probe call is allowed through. A probe success closes it; a
// probe failure re-opens it immediately. Without the probe window
// an open breaker could never close, because skipped calls record
// no success.

/** Consecutive failures that open the breaker — mirrors the DB rule in recordProviderHealth. */
export const PROVIDER_CIRCUIT_BREAKER_THRESHOLD = 5;
/** Cooldown before one probe call is allowed through an open breaker. */
export const PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS = 60_000;

export interface ProviderBreakerState {
  providerKey: string;
  /** True while the breaker is open AND inside its cooldown (calls are skipped). */
  open: boolean;
  /** True when the cooldown has elapsed and one probe call may go through. */
  halfOpen: boolean;
  consecutiveFailures: number;
  openedAt: string | null;
}

const breakerStates = new Map<string, { consecutiveFailures: number; openedAt: number | null }>();

function getBreakerRecord(providerKey: string): { consecutiveFailures: number; openedAt: number | null } {
  let record = breakerStates.get(providerKey);
  if (!record) {
    record = { consecutiveFailures: 0, openedAt: null };
    breakerStates.set(providerKey, record);
  }
  return record;
}

/** Read side of the breaker (B3). Never throws. */
export function getProviderBreakerState(
  providerKey: string,
  nowMs: number = Date.now()
): ProviderBreakerState {
  const record = getBreakerRecord(providerKey);
  const isOpen = record.consecutiveFailures >= PROVIDER_CIRCUIT_BREAKER_THRESHOLD;
  const cooledDown =
    isOpen && record.openedAt !== null && nowMs - record.openedAt >= PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS;
  return {
    providerKey,
    open: isOpen && !cooledDown,
    halfOpen: cooledDown,
    consecutiveFailures: record.consecutiveFailures,
    openedAt: record.openedAt !== null ? new Date(record.openedAt).toISOString() : null,
  };
}

/** True when calls to this provider must be skipped right now (open + inside cooldown). */
export function isProviderCircuitOpen(providerKey: string, nowMs: number = Date.now()): boolean {
  return getProviderBreakerState(providerKey, nowMs).open;
}

/** Test-only reset of the in-memory breaker states. */
export function resetProviderBreakers(): void {
  breakerStates.clear();
}

/** Write side, called by recordProviderHealth below. Exported for tests. */
export function noteProviderBreakerOutcome(
  providerKey: string,
  success: boolean,
  nowMs: number = Date.now()
): void {
  const record = getBreakerRecord(providerKey);
  if (success) {
    record.consecutiveFailures = 0;
    record.openedAt = null;
    return;
  }
  record.consecutiveFailures += 1;
  if (record.consecutiveFailures >= PROVIDER_CIRCUIT_BREAKER_THRESHOLD && record.openedAt === null) {
    record.openedAt = nowMs;
  }
  // A probe failure after the cooldown re-opens immediately.
  if (record.openedAt !== null && nowMs - record.openedAt >= PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS) {
    record.openedAt = nowMs;
  }
}

// ---------------------------------------------------------------------------
// Provider Health
// ---------------------------------------------------------------------------

export interface ProviderHealthUpdate {
  providerKey: string;
  status?: 'healthy' | 'degraded' | 'down' | 'circuit_open';
  success?: boolean;
  error?: string;
  responseMs?: number;
}

export async function recordProviderHealth(
  supabase: AnySupabaseClient,
  update: ProviderHealthUpdate
): Promise<void> {
  // Section 18, item 30 — explicit columns (was select('*')):
  // only the counters the upsert below reads back.
  const existing = await supabase
    .from('provider_health')
    .select('provider_key, success_count, failure_count, consecutive_failures, avg_response_ms')
    .eq('provider_key', update.providerKey)
    .maybeSingle();

  const now = new Date().toISOString();
  const base: Record<string, unknown> = {
    provider_key: update.providerKey,
    updated_at: now,
  };

  if (update.success !== undefined) {
    if (update.success) {
      base.success_count = (existing.data?.success_count ?? 0) + 1;
      base.consecutive_failures = 0;
      base.last_success_at = now;
    } else {
      base.failure_count = (existing.data?.failure_count ?? 0) + 1;
      base.consecutive_failures = (existing.data?.consecutive_failures ?? 0) + 1;
      base.last_failure_at = now;
      if (update.error) base.last_error = update.error;
    }
  }

  if (update.status) base.status = update.status;
  if (update.responseMs !== undefined) {
    const prevAvg = existing.data?.avg_response_ms ?? update.responseMs;
    base.avg_response_ms = Math.round((prevAvg * 0.9 + update.responseMs * 0.1));
  }

  // Circuit breaker: open after 5 consecutive failures
  if ((base.consecutive_failures as number) >= 5) {
    base.status = 'circuit_open';
    base.circuit_opened_at = now;
  }

  // Sections 21–25, Stage B (B3) — mirror the outcome into the
  // in-memory breaker so the call guard can read it. The DB
  // upsert below is best-effort history; the mirror must move
  // even when the table is unapplied.
  if (update.success !== undefined) {
    noteProviderBreakerOutcome(update.providerKey, update.success);
  } else if (update.status === 'circuit_open') {
    // An explicit circuit_open status without a success flag
    // still means the breaker is open: force the mirror open.
    const record = getBreakerRecord(update.providerKey);
    if (record.consecutiveFailures < PROVIDER_CIRCUIT_BREAKER_THRESHOLD) {
      record.consecutiveFailures = PROVIDER_CIRCUIT_BREAKER_THRESHOLD;
    }
    if (record.openedAt === null) record.openedAt = Date.now();
  }

  await supabase.from('provider_health').upsert(base, { onConflict: 'provider_key' });
}

export async function getProviderHealth(
  supabase: AnySupabaseClient
): Promise<Array<{ providerKey: string; status: string; successCount: number; failureCount: number; consecutiveFailures: number; lastSuccessAt: string | null; lastFailureAt: string | null; lastError: string | null; avgResponseMs: number | null }>> {
  const { data } = await supabase
    .from('provider_health')
    .select('provider_key, status, success_count, failure_count, consecutive_failures, last_success_at, last_failure_at, last_error, avg_response_ms')
    .order('provider_key')
    .limit(100);

  return (data ?? []).map((d) => ({
    providerKey: d.provider_key,
    status: d.status,
    successCount: d.success_count,
    failureCount: d.failure_count,
    consecutiveFailures: d.consecutive_failures,
    lastSuccessAt: d.last_success_at,
    lastFailureAt: d.last_failure_at,
    // Sections 21–25, Stage B (B13) — the admin health surface
    // shows the last error, not just the counts.
    lastError: (d as { last_error?: string | null }).last_error ?? null,
    avgResponseMs: d.avg_response_ms,
  }));
}

// ---------------------------------------------------------------------------
// Sync History
// ---------------------------------------------------------------------------

export interface SyncHistoryEntry {
  providerKey: string;
  syncType: string;
  status: string;
  recordsFetched?: number;
  recordsInserted?: number;
  recordsUpdated?: number;
  recordsRejected?: number;
  errorMessage?: string;
  durationMs?: number;
  dataSourceId?: string;
}

export async function recordSyncHistory(
  supabase: AnySupabaseClient,
  entry: SyncHistoryEntry
): Promise<void> {
  await supabase.from('sync_history').insert({
    data_source_id: entry.dataSourceId ?? null,
    provider_key: entry.providerKey,
    sync_type: entry.syncType,
    status: entry.status,
    records_fetched: entry.recordsFetched ?? 0,
    records_inserted: entry.recordsInserted ?? 0,
    records_updated: entry.recordsUpdated ?? 0,
    records_rejected: entry.recordsRejected ?? 0,
    error_message: entry.errorMessage ?? null,
    duration_ms: entry.durationMs ?? null,
    started_at: new Date(Date.now() - (entry.durationMs ?? 0)).toISOString(),
    completed_at: new Date().toISOString(),
  });
}

export async function getSyncHistory(
  supabase: AnySupabaseClient,
  limit: number = 50
): Promise<Array<{ id: string; providerKey: string; syncType: string; status: string; recordsFetched: number; recordsInserted: number; recordsUpdated: number; recordsRejected: number; errorMessage: string | null; durationMs: number | null; startedAt: string; completedAt: string | null }>> {
  const { data } = await supabase
    .from('sync_history')
    .select('id, provider_key, sync_type, status, records_fetched, records_inserted, records_updated, records_rejected, error_message, duration_ms, started_at, completed_at')
    .order('started_at', { ascending: false })
    .limit(limit);

  return (data ?? []).map((d) => ({
    id: d.id,
    providerKey: d.provider_key,
    syncType: d.sync_type,
    status: d.status,
    recordsFetched: d.records_fetched,
    recordsInserted: d.records_inserted,
    recordsUpdated: d.records_updated,
    recordsRejected: d.records_rejected,
    errorMessage: d.error_message,
    durationMs: d.duration_ms,
    startedAt: d.started_at,
    completedAt: d.completed_at,
  }));
}

// ---------------------------------------------------------------------------
// Queue Metrics
// ---------------------------------------------------------------------------

export interface QueueMetricEntry {
  queueName: string;
  waitingCount: number;
  activeCount: number;
  completedCount: number;
  failedCount: number;
  delayedCount: number;
  throughputPerMin: number;
  avgLatencyMs?: number;
}

export async function recordQueueMetrics(
  supabase: AnySupabaseClient,
  entry: QueueMetricEntry
): Promise<void> {
  await supabase.from('queue_metrics').insert({
    queue_name: entry.queueName,
    metric_type: 'snapshot',
    waiting_count: entry.waitingCount,
    active_count: entry.activeCount,
    completed_count: entry.completedCount,
    failed_count: entry.failedCount,
    delayed_count: entry.delayedCount,
    throughput_per_min: entry.throughputPerMin,
    avg_latency_ms: entry.avgLatencyMs ?? null,
  });
}

export async function getQueueMetrics(
  supabase: AnySupabaseClient,
  limit: number = 50
): Promise<Array<{ queueName: string; waitingCount: number; activeCount: number; completedCount: number; failedCount: number; throughputPerMin: number; avgLatencyMs: number | null; recordedAt: string }>> {
  const { data } = await supabase
    .from('queue_metrics')
    .select('queue_name, waiting_count, active_count, completed_count, failed_count, throughput_per_min, avg_latency_ms, recorded_at')
    .order('recorded_at', { ascending: false })
    .limit(limit);

  return (data ?? []).map((d) => ({
    queueName: d.queue_name,
    waitingCount: d.waiting_count,
    activeCount: d.active_count,
    completedCount: d.completed_count,
    failedCount: d.failed_count,
    throughputPerMin: d.throughput_per_min,
    avgLatencyMs: d.avg_latency_ms,
    recordedAt: d.recorded_at,
  }));
}

// ---------------------------------------------------------------------------
// Cache Metrics
// ---------------------------------------------------------------------------

export async function recordCacheMetrics(
  supabase: AnySupabaseClient,
  namespace: string,
  hits: number,
  misses: number,
  evictions: number = 0,
  sizeBytes?: number
): Promise<void> {
  await supabase.from('cache_metrics').insert({
    cache_namespace: namespace,
    hit_count: hits,
    miss_count: misses,
    eviction_count: evictions,
    size_bytes: sizeBytes ?? null,
  });
}

// ---------------------------------------------------------------------------
// Dashboard Summary
// ---------------------------------------------------------------------------

export interface MonitoringSummary {
  providers: Array<{ providerKey: string; status: string; successCount: number; failureCount: number }>;
  recentSyncs: Array<{ id: string; providerKey: string; status: string; recordsFetched: number; startedAt: string }>;
  queueMetrics: Array<{ queueName: string; waitingCount: number; activeCount: number; failedCount: number }>;
  totalProducts: number;
  staleProducts: number;
}

export async function getMonitoringSummary(
  supabase: AnySupabaseClient
): Promise<MonitoringSummary> {
  const [providers, recentSyncs, queueMetrics] = await Promise.all([
    getProviderHealth(supabase),
    getSyncHistory(supabase, 10),
    getQueueMetrics(supabase, 10),
  ]);

  const { count: totalProducts } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null);

  const { count: staleProducts } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null)
    .lt('next_refresh_at', new Date().toISOString());

  return {
    providers: providers.map((p) => ({
      providerKey: p.providerKey,
      status: p.status,
      successCount: p.successCount,
      failureCount: p.failureCount,
    })),
    recentSyncs: recentSyncs.map((s) => ({
      id: s.id,
      providerKey: s.providerKey,
      status: s.status,
      recordsFetched: s.recordsFetched,
      startedAt: s.startedAt,
    })),
    queueMetrics: queueMetrics.map((q) => ({
      queueName: q.queueName,
      waitingCount: q.waitingCount,
      activeCount: q.activeCount,
      failedCount: q.failedCount,
    })),
    totalProducts: totalProducts ?? 0,
    staleProducts: staleProducts ?? 0,
  };
}
