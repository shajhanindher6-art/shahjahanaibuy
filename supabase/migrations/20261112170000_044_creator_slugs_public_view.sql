-- Migration 044 — public creator-slug list for the soft-404 middleware
-- (Section 16 live-recheck gap, 2026-11-12).
--
-- Owner must run once in Supabase (SQL Editor). Code NEVER applies it.
-- Until then the middleware fails open for /creators (current live
-- behaviour, pinned by tests) and activates automatically once this
-- runs — no redeploy needed: the middleware treats a missing view
-- (PGRST205) as fail-open and a present view as the source of truth.
--
-- WHY A VIEW (not a public SELECT policy on profiles): a policy on
-- profiles would expose EVERY column of a creator's row (email,
-- full_name, ...) to anon. This view exposes ONLY the two columns
-- the middleware needs — id + creator_slug — and nothing else.
-- creator_slug is public by design: the /creators index links to
-- /creators/[slug] for every listed creator.
--
-- security_invoker = false (Postgres 15+): the view runs as its
-- owner (postgres, when run in the SQL Editor) and bypasses the
-- profiles RLS that hides other users' rows from anon. The view's
-- own SELECT grant is what gates access. If the view is ever
-- dropped, PostgREST answers PGRST205 and the middleware fails
-- open again — never a 500, never a false 404.
--
-- PostgREST picks up new views automatically (schema-cache reload
-- on DDL via NOTIFY). If the view does not appear in the REST API
-- immediately, use Dashboard -> Settings -> API -> "Reload schema
-- cache".
CREATE OR REPLACE VIEW public.creator_slugs
WITH (security_invoker = false) AS
SELECT id, creator_slug
FROM public.profiles
WHERE creator_slug IS NOT NULL;

GRANT SELECT ON public.creator_slugs TO anon, authenticated;

-- Verify (the SQL editor shows only this last result):
SELECT 'creator_slugs view ready' AS status;
