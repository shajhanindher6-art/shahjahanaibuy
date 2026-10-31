-- ============================================================================
-- Public wishlist sharing — anon SELECT policies
-- ============================================================================
-- Run this ONCE in the Supabase SQL editor (Dashboard > SQL editor).
-- It is NOT applied automatically by pushing code to GitHub.
--
-- Why it is needed: migration 006 only allows owners to SELECT their
-- own wishlists (auth.uid() = user_id). The public shared page
-- (/wishlists/[id], API /api/v1/shared-wishlists/[id]) runs as the
-- anon role for logged-out visitors, so without these policies every
-- shared link returns 404 — even for lists marked public.
--
-- What it allows (and nothing more):
--   * anon + authenticated roles may SELECT a wishlist ONLY when
--     is_public = true.
--   * anon + authenticated roles may SELECT wishlist_items ONLY when
--     their parent wishlist is_public = true.
-- Private lists stay invisible: a private list's rows are still
-- blocked, and the API returns the same 404 for private and missing
-- lists, so private lists cannot be probed.
-- No INSERT / UPDATE / DELETE policy is added here — sharing is
-- read-only, and owners still manage lists through their own
-- authenticated policies.
-- ============================================================================

-- Wishlists: public rows readable by anyone (logged out or in).
DROP POLICY IF EXISTS "wishlists_select_public" ON wishlists;
CREATE POLICY "wishlists_select_public" ON wishlists FOR SELECT
  TO anon, authenticated
  USING (is_public = true);

-- Wishlist items: readable only via a public parent wishlist.
DROP POLICY IF EXISTS "wishlist_items_select_public" ON wishlist_items;
CREATE POLICY "wishlist_items_select_public" ON wishlist_items FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM wishlists w
      WHERE w.id = wishlist_items.wishlist_id
        AND w.is_public = true
    )
  );

-- ============================================================================
-- Verify (run after applying; both rows should appear)
-- ============================================================================
-- SELECT schemaname, tablename, policyname, roles, cmd
-- FROM pg_policies
-- WHERE policyname IN ('wishlists_select_public', 'wishlist_items_select_public')
-- ORDER BY tablename, policyname;
