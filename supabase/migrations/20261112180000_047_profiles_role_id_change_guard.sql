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
    IF current_user NOT IN ('postgres', 'service_role') THEN
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

-- VERIFICATION (last statement: this is what the editor shows).
-- Expect one row: the trigger on profiles.
SELECT trigger_name, event_object_table, action_timing, event_manipulation
FROM information_schema.triggers
WHERE trigger_name = 'prevent_profiles_role_id_change';
