-- 047 — Block self-promotion: profiles.role_id cannot be changed by the row owner.
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor).
--
-- WHAT WAS WRONG (Section 17 audit §4 #2, HIGH):
--   `profiles_update_own` (migration 001) lets any signed-in user
--   UPDATE their own profile row. Its comment says "Users can update
--   their own profile (but not their role or email)" — but the policy
--   is only USING (auth.uid() = id) WITH CHECK (auth.uid() = id):
--   it restricts WHICH row, not WHICH COLUMNS. Nothing stops
--     UPDATE profiles
--     SET role_id = (SELECT id FROM roles WHERE name = 'admin')
--     WHERE id = auth.uid();
--   and `roles` is world-readable, so the admin role's UUID is public.
--   Combined with the item-7 fix (admin resolved via
--   role_id → roles.name), a self-promoted row would make the caller
--   an admin everywhere: admin API routes, /admin, is_admin()-gated
--   RLS writes.
--
-- WHY A TRIGGER, NOT A POLICY:
--   An RLS policy cannot compare the OLD and NEW row — WITH CHECK
--   only sees the new row, and `auth.uid() = id` is true for both a
--   legitimate profile edit and a role_id change. A BEFORE UPDATE
--   trigger is the only mechanism that can see the change itself.
--   (This matches the repo's existing trigger style in 001:
--   plpgsql, SECURITY DEFINER SET search_path = public,
--   DROP TRIGGER IF EXISTS + CREATE TRIGGER.)
--
-- WHO CAN STILL CHANGE role_id:
--   Legitimate promotion/demotion happens only out-of-band:
--     * Supabase SQL Editor — runs as `postgres`.
--     * The service-role client — PostgREST sets the role to
--       `service_role` for the service key.
--   Both are exempted below. A signed-in user calling through
--   PostgREST runs as `authenticated` (or `anon`) and is blocked.
--   No application code updates role_id today (verified 2026-11-12:
--   the only `role_id` reference in lib/services/app is the read in
--   services/profiles.ts), so the trigger blocks nothing legitimate
--   in the app — there is no admin "change user role" UI to break.
--   If one is ever built, it must use the service-role client.
--
-- DEPENDS ON: 001 (profiles + roles tables exist).

CREATE OR REPLACE FUNCTION public.prevent_profiles_role_id_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF OLD.role_id IS DISTINCT FROM NEW.role_id THEN
    -- Section 18, final fix (12 Nov 2026): the old check used
    -- `current_user`, but inside a SECURITY DEFINER function
    -- `current_user` is the FUNCTION OWNER (postgres, when applied
    -- from the SQL Editor), not the caller — so the guard could
    -- never fire. `auth.uid()` reads the caller's JWT claim and
    -- works inside SECURITY DEFINER functions: a real user UUID
    -- for a signed-in caller (block), and NULL when no user JWT
    -- is present. Exempted callers remain only
    -- 'postgres', 'service_role' — both present no user JWT, so
    -- auth.uid() IS NULL for them and the change is allowed.
    IF auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION
        'profiles.role_id cannot be changed by the row owner (use the Supabase SQL Editor or the service-role client to change a user''s role)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_profiles_role_id_change ON profiles;
CREATE TRIGGER prevent_profiles_role_id_change
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_profiles_role_id_change();

-- ==========================================================================
-- INSERT GUARD (Section 18, Phase 2, item 3 — audit §1 #53, LOW).
--
-- `profiles_insert_own` (001) was only
-- `WITH CHECK (auth.uid() = id)` with no column restriction, so a
-- signed-in user could INSERT their own row with `role_id` = the
-- admin role's UUID. The UPDATE trigger above does not cover
-- INSERT (there is no OLD row to compare). Mitigated in practice:
-- `handle_new_user()` creates the row with the 'user' role in the
-- same transaction as the auth.users insert, and no `profiles FOR
-- DELETE` policy exists anywhere, so a user cannot
-- delete-then-reinsert — but a direct INSERT with an admin role_id
-- was still possible if the trigger path was ever skipped.
--
-- WHY A POLICY GUARD, NOT EXTENDING THE TRIGGER: a `WITH CHECK`
-- clause CAN restrict the new row's columns (unlike UPDATE, where
-- the policy cannot see the OLD row), so the policy is the smaller,
-- re-apply-safe change: DROP + CREATE, same style as 001. The
-- guard allows exactly the role_ids a legitimate insert can carry:
-- NULL (column has no default; app code never inserts a profile
-- row — verified 2026-11-12, grep for profiles inserts in
-- app/lib/services/features is empty) or the 'user' role's id.
-- `handle_new_user()` inserts role_id = the 'user' role id, so it
-- passes this check even if RLS applies to it; it also runs
-- SECURITY DEFINER as the table owner, which bypasses RLS
-- entirely. No legitimate insert is blocked.
--
-- NOTE (FIXED 12 Nov 2026 — Section 18 final fix): the UPDATE
-- trigger above used to check `current_user`, but inside a
-- SECURITY DEFINER function `current_user` is the FUNCTION OWNER
-- (postgres, when applied from the SQL Editor), not the caller —
-- so the UPDATE guard as written could never fire. CONFIRMED:
-- the function is SECURITY DEFINER and the check was
-- `current_user NOT IN ('postgres', 'service_role')`. It now
-- uses `auth.uid()` (NULL = no user JWT: SQL Editor /
-- service-role; non-NULL = signed-in caller, blocked). The INSERT
-- guard below does not share that flaw: RLS policy expressions
-- evaluate as the calling user.
-- ==========================================================================
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = id
    AND (
      role_id IS NULL
      OR role_id = (SELECT id FROM roles WHERE name = 'user' LIMIT 1)
    )
  );

-- VERIFICATION (last statements: this is what the editor shows).
-- Expect one row: the trigger on profiles.
SELECT trigger_name, event_object_table, action_timing, event_manipulation
FROM information_schema.triggers
WHERE trigger_name = 'prevent_profiles_role_id_change';

-- Expect one row: the insert policy with the role_id guard.
-- The qual column must contain both `auth.uid() = id` and the
-- `roles WHERE name = 'user'` subquery.
SELECT policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'profiles'
  AND policyname = 'profiles_insert_own';
