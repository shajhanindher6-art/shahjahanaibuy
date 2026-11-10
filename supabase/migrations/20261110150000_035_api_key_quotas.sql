-- 035 — Public API quota ledger (Section 9, chunk 3).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. The runtime quota enforcement in lib/api-quota.ts works
-- today on its in-memory daily store (same pattern as the in-memory
-- fallback in lib/api/middleware.ts), so no migration is required
-- for the paywall to function. This table exists so a future
-- cross-instance, durable counter can replace the in-memory store
-- without a schema change: one row per key hash per UTC day.
--
--   * api_key_usage stores ONLY the SHA-256 hash of a key (the same
--     hash stored in api_keys, migration 032) — never the key itself.
--   * request_count is a plain recorded counter, incremented by the
--     server only. No invented or backfilled rows: the table starts
--     EMPTY and a missing row means "no recorded usage", never zero
--     by assumption in any consumer.
--   * No RLS policy grants anon/authenticated any access — the table
--     is writable only via the service-role client, exactly like the
--     other server-only tables in migration 032.

CREATE TABLE IF NOT EXISTS public.api_key_usage (
  key_hash TEXT NOT NULL,
  window_date DATE NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  tier TEXT NOT NULL DEFAULT 'free',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (key_hash, window_date)
);

ALTER TABLE public.api_key_usage ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS api_key_usage_window_date_idx
  ON public.api_key_usage (window_date);
