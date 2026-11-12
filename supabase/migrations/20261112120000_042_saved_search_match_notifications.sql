-- 042 — Saved-search match notifications (Section 16, #32).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor). Until it is applied, saved searches keep
-- working exactly as before (name + re-run URL only) and the
-- notify toggle answers with "not available yet" (503) — no
-- notification is ever queued for a search whose opt-in column
-- does not exist.
--
-- WHAT THIS ADDS (two columns on the existing saved_searches table
-- from migration 039 — no new table):
--   * `notify_on_match` boolean NOT NULL DEFAULT false — the user
--     opted in to "notify me when a new product matches this
--     saved search". Off by default; existing rows stay off.
--   * `last_notified_at` timestamptz NULL — the last time the
--     refresh chain queued a match notification for this search.
--     NULL means "never notified". The matcher only considers
--     products created AFTER this timestamp, so a product is never
--     notified twice for the same search.
--
-- HOW MATCHING WORKS (services/saved-searches.ts):
--   * The refresh chain (POST /api/v1/prices/refresh, step
--     `savedSearches`) loads every opted-in search and the current
--     product set, and queues one notification_queue row per
--     (search, new matching product) via services/notifications.ts
--     queueNotification. Delivery itself is the existing
--     notification pipeline — this migration adds no sender.
--   * Turning notify ON sets last_notified_at = now(), so only
--     products added AFTER the opt-in can ever match — enabling
--     notifications never spams the user with the existing
--     10-product catalog.
--
-- RULES ENFORCED HERE (and mirrored in services/saved-searches.ts):
--   * A user reads/writes ONLY their own rows (migration 039 RLS
--     USING/WITH CHECK auth.uid() = user_id is unchanged — these
--     columns ride on the same policies).
--   * No invented data: both columns start at their defaults and
--     only ever change from an explicit user toggle or a real
--     queued notification. Never backfill rows.

ALTER TABLE IF EXISTS public.saved_searches
  ADD COLUMN IF NOT EXISTS notify_on_match boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_notified_at timestamptz;

-- Opted-in searches, oldest notification first (the refresh chain's
-- scan order).
CREATE INDEX IF NOT EXISTS idx_saved_searches_notify
  ON public.saved_searches (notify_on_match, last_notified_at)
  WHERE notify_on_match = true;
