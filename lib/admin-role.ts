/**
 * Admin role resolution — Section 17, Stage H, item 7 (audit §4 #1).
 *
 * THE BUG: `requireAdmin`, `app/admin/layout.tsx`, `getAllUsers` and
 * `public.is_admin()` (migration 017) all read a `profiles.role`
 * column that DOES NOT EXIST in the migration chain. `profiles` as
 * created in migration 001 has only `role_id` (FK to `roles.id`); no
 * migration ever adds a `role` column. Reading `role` therefore
 * errors (or returns nothing), so every admin check failed closed —
 * the whole admin surface was unusable.
 *
 * THE FIX: resolve the role exactly the way `services/profiles.ts`
 * already does — embed the `roles` relation in the select
 * (`role_id, roles ( name )`) and read `roles.name`, defaulting to
 * `'user'` when the join is empty. `is_admin()` (017) does the same
 * join in SQL.
 *
 * ⚠️ DEPENDENCY FLAG — read before touching this file: this fix is
 * written against the MIGRATION CHAIN (no `role` column exists). The
 * live database was never verified in the Section 17 audit — its
 * applied status is UNKNOWN, and it may have a `role` column added
 * out-of-band (the audit's §4 #1 caveat). If the owner later reports
 * the live DB DOES have a `profiles.role` column, this fix needs
 * revisiting: the two sources could disagree (a `role` column value
 * vs the `roles` join), and the live column — not the join — would
 * be the source of truth to align to. Until that check is done, the
 * join below is the correct resolution for the schema as written.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';

/** PostgREST select fragment that resolves a profile's role name via
 *  the `role_id → roles.name` join — the same shape
 *  `services/profiles.ts` (`getProfile`) already selects. */
export const PROFILE_ROLE_SELECT = 'role_id, roles ( name, permissions )';
/**
 * Final 100%, F-P1-61 — the select fragment now also reads
 * `roles.permissions` (the `permissions` JSONB array from migration
 * 001, seeded e.g. `["*"]` for admin, `["manage:products"]` for
 * merchant). The permissions column was never read before this
 * change; it is now wired into every admin check (see
 * `hasAdminPermission` below).
 */

/**
 * One row of a `profiles` select that embeds the `roles` relation.
 * PostgREST returns the many-to-one embed as a single object, but
 * tolerate the array shape too — a defensive parse must never turn
 * an unexpected shape into an admin.
 */
export type ProfileRoleRow = {
  role_id?: string | null;
  roles?: {
    name?: string | null;
    /** The role's `permissions` JSONB array (migration 001 seed). */
    permissions?: unknown;
  } | Array<{
    name?: string | null;
    permissions?: unknown;
  }> | null;
};

/**
 * Pure permission resolution: the `roles.permissions` JSONB array
 * from the join, or `[]` when there is no row, no join, or the value
 * is not an array of strings. Never throws, never defaults to admin.
 * (Final 100%, F-P1-61 — the permissions column was never read
 * before this change.)
 */
export function resolveRolePermissions(row: ProfileRoleRow | null | undefined): string[] {
  if (!row) return [];
  const roles = row.roles;
  const raw = Array.isArray(roles) ? roles[0]?.permissions : roles?.permissions;
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is string => typeof p === 'string' && p.length > 0);
}

/**
 * True only when the row is the admin role AND its permissions
 * grant admin access — the wildcard `'*'` (the seeded admin value)
 * or the explicit `'admin:access'` permission. Fail-closed by
 * design: a missing/empty/non-array permissions value is NO admin
 * action, even for a row whose name is 'admin'. This is the bounded
 * wiring of the `permissions` JSONB into the existing admin-role
 * check — it is NOT a full RBAC system: there is still no
 * per-permission architecture, no admin user management UI, and no
 * route-level permission beyond admin/not-admin. That remaining
 * architecture gap is documented, not hidden (see
 * docs/migration-runbook.md / the owner checklist §5b).
 */
export function hasAdminPermission(row: ProfileRoleRow | null | undefined): boolean {
  if (!isAdminRoleRow(row)) return false;
  const permissions = resolveRolePermissions(row);
  return permissions.includes('*') || permissions.includes('admin:access');
}

/**
 * Pure role-name resolution: the `roles.name` from the join, or
 * `'user'` when there is no row, no join, or no name. Never throws,
 * never defaults to admin.
 */
export function resolveRoleName(row: ProfileRoleRow | null | undefined): string {
  if (!row) return 'user';
  const roles = row.roles;
  const name = Array.isArray(roles) ? roles[0]?.name : roles?.name;
  return typeof name === 'string' && name.length > 0 ? name : 'user';
}

/** True only when the resolved role name is exactly `'admin'`. */
export function isAdminRoleRow(row: ProfileRoleRow | null | undefined): boolean {
  return resolveRoleName(row) === 'admin';
}

/**
 * Fetch one user's role name via the service-role client (RLS would
 * otherwise hide other users' rows, and the callers of this helper
 * are server-side admin guards). Returns `null` on any DB error or
 * missing profile so callers fail closed — never `'admin'`.
 */
export async function fetchProfileRoleName(
  client: AnySupabaseClient,
  userId: string
): Promise<string | null> {
  const { data, error } = await client
    .from('profiles')
    .select(PROFILE_ROLE_SELECT)
    .eq('id', userId)
    .single();
  if (error || !data) return null;
  return resolveRoleName(data as unknown as ProfileRoleRow);
}

/**
 * Fetch one user's role name AND permissions via the service-role
 * client (Final 100%, F-P1-61). Returns `null` on any DB error or
 * missing profile so callers fail closed — never `'admin'`.
 * `fetchProfileRoleName` (above) is kept for callers that only need
 * the name; admin guards must use this one (or `hasAdminPermission`
 * on the row) so the `permissions` JSONB is actually enforced.
 */
export async function fetchProfileRoleWithPermissions(
  client: AnySupabaseClient,
  userId: string
): Promise<{ roleName: string; permissions: string[] } | null> {
  const { data, error } = await client
    .from('profiles')
    .select(PROFILE_ROLE_SELECT)
    .eq('id', userId)
    .single();
  if (error || !data) return null;
  const row = data as unknown as ProfileRoleRow;
  return { roleName: resolveRoleName(row), permissions: resolveRolePermissions(row) };
}

/**
 * Defense-in-depth role re-check — Sections 21–25, Stage G,
 * G-P1-4 (audit §1 #26).
 *
 * Admin data services (services/admin.ts, refresh-runs-admin.ts,
 * error-log-admin.ts, admin-data-quality.ts) read through the
 * service-role client, which bypasses RLS entirely — so before a
 * read, the layout guard was the ONLY thing standing between a
 * non-admin caller and the data. Every one of those services now
 * calls this helper (when the caller passes the authenticated
 * user id) and throws before touching its table when the user is
 * not an admin. Fail closed: a missing user id, a missing
 * profile, or any DB error throws — a guard that cannot verify
 * must never let the read through.
 *
 * Callers pass the already-authenticated user id (from
 * `requireAdmin` in routes, from `getUser()` in server pages).
 * The `adminUserId` parameter on the services is optional ONLY so
 * existing unit tests that exercise the data mapping without an
 * auth context keep compiling; every production caller passes it.
 * A service called without it performs the read unguarded, exactly
 * as before — the layout/route guard remains the only check on
 * that path, and that gap is documented on each service, not
 * hidden.
 */
export async function assertAdminServiceAccess(
  client: AnySupabaseClient,
  adminUserId: string | null | undefined
): Promise<void> {
  if (!adminUserId) {
    throw new Error('Admin access required');
  }
  // Final 100%, F-P1-61 — the permissions JSONB is enforced here
  // too: an admin-named role with no '*' / 'admin:access'
  // permission (or no permissions value at all) is denied.
  const role = await fetchProfileRoleWithPermissions(client, adminUserId);
  if (!role || role.roleName !== 'admin' || !(role.permissions.includes('*') || role.permissions.includes('admin:access'))) {
    throw new Error('Admin access required');
  }
}
