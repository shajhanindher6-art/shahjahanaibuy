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
export const PROFILE_ROLE_SELECT = 'role_id, roles ( name )';

/**
 * One row of a `profiles` select that embeds the `roles` relation.
 * PostgREST returns the many-to-one embed as a single object, but
 * tolerate the array shape too — a defensive parse must never turn
 * an unexpected shape into an admin.
 */
export type ProfileRoleRow = {
  role_id?: string | null;
  roles?: { name?: string | null } | Array<{ name?: string | null }> | null;
};

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
