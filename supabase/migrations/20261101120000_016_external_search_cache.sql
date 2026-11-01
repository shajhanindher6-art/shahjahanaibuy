-- 016 — External web-search cache (SerpAPI Google Shopping fallback)
--
-- Run this ONCE in the Supabase SQL editor. Until it is run, the web
-- fallback still works (live SerpAPI calls + per-instance memory cache);
-- only the persistent 7-day cache is missing, so repeat queries cost
-- quota until this table exists.
--
-- What this table holds: ONLY public web-search results (query + the
-- normalized shopping rows SerpAPI returned). No user data, no secrets,
-- no catalog products. Web results are NEVER written to `products`.
--
-- RLS trade-off, stated plainly: anon SELECT + anon INSERT are granted
-- so the catalog-only search route (which runs as the anon server
-- client for logged-out visitors) can read and populate the cache
-- without a service-role key. Abuse is limited to polluting a public
-- cache entry for one exact query, which expires in 7 days and is
-- only served for that query. If you prefer stricter access, revoke
-- the anon INSERT policy and the cache will only work when the
-- service-role key is configured.

CREATE TABLE IF NOT EXISTS external_search_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_key text NOT NULL UNIQUE,
  query text NOT NULL,
  normalized_query text NOT NULL,
  results jsonb NOT NULL CHECK (jsonb_typeof(results) = 'array'),
  source text NOT NULL DEFAULT 'serpapi_google_shopping',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_external_search_cache_normalized
  ON external_search_cache (normalized_query);

ALTER TABLE external_search_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "external_search_cache_select_public" ON external_search_cache;
CREATE POLICY "external_search_cache_select_public"
  ON external_search_cache FOR SELECT
  TO anon, authenticated
  USING (expires_at > now());

DROP POLICY IF EXISTS "external_search_cache_insert_public" ON external_search_cache;
CREATE POLICY "external_search_cache_insert_public"
  ON external_search_cache FOR INSERT
  TO anon, authenticated
  WITH CHECK (jsonb_typeof(results) = 'array');
