/*
# SmartBuy AI — Monitoring & Freshness Tables (Phase 2 Upgrade, Migration 5)

## Overview
Creates the monitoring and observability layer: sync_history, provider_health,
queue_metrics, and cache_metrics. These tables power the admin monitoring dashboard
and the adaptive data freshness system.

## 1. New Tables

### `sync_history`
- Audit log of all data sync operations (provider fetches, CSV imports, etc.)
- `id` (uuid PK), `data_source_id` (FK, nullable), `provider_key`
- `sync_type` (full, incremental, delta, manual)
- `status` (success, failed, partial, running)
- `records_fetched`, `records_inserted`, `records_updated`, `records_rejected`
- `error_message`, `duration_ms`, `started_at`, `completed_at`
- Indexed on `(provider_key, started_at DESC)`, `status`

### `provider_health`
- Real-time health tracking per provider (circuit breaker state, success rate)
- `id` (uuid PK), `provider_key` (unique)
- `status` (healthy, degraded, down, circuit_open)
- `success_count`, `failure_count`, `consecutive_failures`
- `last_success_at`, `last_failure_at`, `last_error`
- `circuit_opened_at`, `avg_response_ms`
- `updated_at`
- Indexed on `provider_key`

### `queue_metrics`
- Snapshot of queue health (jobs waiting, active, completed, failed)
- `id` (uuid PK), `queue_name`, `metric_type` (snapshot, event)
- `waiting_count`, `active_count`, `completed_count`, `failed_count`
- `delayed_count`, `throughput_per_min`, `avg_latency_ms`
- `recorded_at`
- Indexed on `(queue_name, recorded_at DESC)`

### `cache_metrics`
- Cache hit/miss statistics for monitoring cache effectiveness
- `id` (uuid PK), `cache_namespace` (product, price, search, etc.)
- `hit_count`, `miss_count`, `eviction_count`, `size_bytes`
- `recorded_at`
- Indexed on `(cache_namespace, recorded_at DESC)`

## 2. Security (RLS)
- `sync_history`: public read, no client write (admin monitoring)
- `provider_health`: public read, no client write
- `queue_metrics`: public read, no client write
- `cache_metrics`: public read, no client write

## 3. Triggers
- `update_provider_health_updated_at()`: maintains `updated_at` on provider_health

## 4. Important Notes
1. `sync_history` is append-only — never updated or deleted
2. `provider_health` is a singleton per provider (unique provider_key) — upserted
3. `queue_metrics` stores periodic snapshots for trend analysis
4. `cache_metrics` tracks cache effectiveness per namespace
5. Circuit breaker state is stored in `provider_health.status` as 'circuit_open'
*/

-- ============================================================================
-- SYNC_HISTORY TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS sync_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_source_id uuid REFERENCES data_sources(id) ON DELETE SET NULL,
  provider_key text NOT NULL,
  sync_type text NOT NULL DEFAULT 'incremental',
  status text NOT NULL DEFAULT 'running',
  records_fetched integer NOT NULL DEFAULT 0,
  records_inserted integer NOT NULL DEFAULT 0,
  records_updated integer NOT NULL DEFAULT 0,
  records_rejected integer NOT NULL DEFAULT 0,
  error_message text,
  duration_ms integer,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE sync_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sync_history_select_all" ON sync_history;
CREATE POLICY "sync_history_select_all" ON sync_history FOR SELECT
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS sync_history_provider_started_idx ON sync_history(provider_key, started_at DESC);
CREATE INDEX IF NOT EXISTS sync_history_status_idx ON sync_history(status);

-- ============================================================================
-- PROVIDER_HEALTH TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS provider_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key text UNIQUE NOT NULL,
  status text NOT NULL DEFAULT 'healthy',
  success_count integer NOT NULL DEFAULT 0,
  failure_count integer NOT NULL DEFAULT 0,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  circuit_opened_at timestamptz,
  avg_response_ms integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE provider_health ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "provider_health_select_all" ON provider_health;
CREATE POLICY "provider_health_select_all" ON provider_health FOR SELECT
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS provider_health_key_idx ON provider_health(provider_key);

DROP TRIGGER IF EXISTS update_provider_health_updated_at ON provider_health;
CREATE TRIGGER update_provider_health_updated_at
  BEFORE UPDATE ON provider_health
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- QUEUE_METRICS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS queue_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_name text NOT NULL,
  metric_type text NOT NULL DEFAULT 'snapshot',
  waiting_count integer NOT NULL DEFAULT 0,
  active_count integer NOT NULL DEFAULT 0,
  completed_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  delayed_count integer NOT NULL DEFAULT 0,
  throughput_per_min integer NOT NULL DEFAULT 0,
  avg_latency_ms integer,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE queue_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "queue_metrics_select_all" ON queue_metrics;
CREATE POLICY "queue_metrics_select_all" ON queue_metrics FOR SELECT
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS queue_metrics_name_recorded_idx ON queue_metrics(queue_name, recorded_at DESC);

-- ============================================================================
-- CACHE_METRICS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS cache_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_namespace text NOT NULL,
  hit_count integer NOT NULL DEFAULT 0,
  miss_count integer NOT NULL DEFAULT 0,
  eviction_count integer NOT NULL DEFAULT 0,
  size_bytes bigint,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cache_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cache_metrics_select_all" ON cache_metrics;
CREATE POLICY "cache_metrics_select_all" ON cache_metrics FOR SELECT
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS cache_metrics_ns_recorded_idx ON cache_metrics(cache_namespace, recorded_at DESC);
