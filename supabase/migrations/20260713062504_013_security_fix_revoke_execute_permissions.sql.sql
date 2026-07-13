-- =============================================================
-- Security Fix: Revoke unnecessary EXECUTE permissions on
-- trigger functions. These are only called by database triggers,
-- not by client-side RPC, so anon/authenticated/PUBLIC don't
-- need EXECUTE.
--
-- handle_new_user() MUST remain SECURITY DEFINER — it's the
-- trigger on auth.users AFTER INSERT, fired by supabase_auth_admin
-- which has no RLS permissions on public.profiles.
-- =============================================================

-- --- handle_new_user (SECURITY DEFINER, required by Supabase Auth) ---
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;

-- Grant EXECUTE to supabase_auth_admin (the role that fires the trigger on auth.users)
-- and service_role (for admin/migration use). postgres always has EXECUTE as owner.
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

-- --- handle_new_profile (SECURITY INVOKER, trigger on public.profiles) ---
REVOKE EXECUTE ON FUNCTION public.handle_new_profile() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_profile() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_profile() FROM authenticated;

-- Trigger on public.profiles fires as the table owner (postgres), which already has EXECUTE.
-- Grant to service_role for admin use.
GRANT EXECUTE ON FUNCTION public.handle_new_profile() TO service_role;

-- --- update_updated_at_column (SECURITY INVOKER, trigger on multiple tables) ---
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM authenticated;

GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO service_role;
