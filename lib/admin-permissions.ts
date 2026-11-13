/**
 * Admin role / permission architecture — Sections 21–25, Stage G,
 * G-P1-1 (audit §1 #23).
 *
 * THE GAP: the only authorization in the tree was the binary admin
 * flag (`requireAdmin`: role name === 'admin'). The `roles`
 * table has a `permissions` JSONB array column (migration 001) and
 * seeds real permission strings — `merchant` is seeded with
 * `manage:products`, `admin` with `['*']` — but NOTHING ever read
 * that column (0 hits), and there was no admin user-management
 * (role assignment is SQL-Editor-only). A merchant user therefore
 * could not do the one thing their role promises, and no code
 * could ever ask "may this role do X?".
 *
 * WHAT THIS MODULE IS:
 * - The permission vocabulary (string constants, one list).
 * - `hasPermission(roleName, permission, granted?)` — the pure
 *   check. `admin` grants everything; any other role grants a
 *   permission only when it is in its granted list (DB
 *   `roles.permissions` when supplied, otherwise the seeded
 *   defaults below, which mirror migration 001 exactly).
 * - `fetchRolePermissions(client, userId)` — reads the caller's
 *   role name + `roles.permissions` JSONB via the service-role
 *   client (role_id → roles join, same as lib/admin-role.ts).
 *   Returns null on any DB error / missing profile → fail closed.
 * - `requirePermission(request, permission)` — API guard:
 *   requireAdmin first, then the permission check. Admins pass
 *   every permission; a merchant passes `manage:products` only.
 *
 * WHAT IT IS NOT (owner-gated, documented, not built here):
 * - Admin user-management UI: there is no UI to list users and
 *   change their `role_id`, and no API for it either. Role
 *   assignment stays SQL-Editor-only until the owner applies
 *   migration 047 (which guards `role_id` changes) and asks for
 *   the UI — building a role-change UI on top of the open
 *   self-promotion hole (audit P0 #3) would hand every signed-in
 *   user the button. See `docs/` note in the module footer.
 * - Editing `roles.permissions` itself: SQL-only. No route writes
 *   to the `roles` table.
 * - `services/admin-products.ts` is NOT wired to this module in
 *   this change (another worker owns that file) — its routes are
 *   guarded at the route layer instead (see
 *   app/api/v1/admin/products/[id]/route.ts).
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireAdmin } from '@/lib/api/middleware';
import { forbidden, internalError, unauthorized } from '@/lib/api/responses';
import type { NextRequest } from 'next/server';

/** Every permission the admin surfaces know about. */
export const ADMIN_PERMISSIONS = [
  'manage:products',
  'manage:merchants',
  'manage:ingestion',
  'manage:alerts',
  'manage:newsletter',
  'manage:fact-checks',
  'manage:ai-jobs',
  'manage:users',
  'view:audit-logs',
  'manage:settings',
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

/**
 * Seeded role → permissions defaults, mirroring migration 001
 * (`INSERT INTO roles ...`) exactly. Used ONLY when the DB row
 * cannot be read (no `roles.permissions` value supplied); the DB
 * value, when present, always wins over this map. Keep in sync
 * with 001 — a drift here is a silent privilege change, which is
 * why the tests pin this table against the migration file.
 */
export const ROLE_DEFAULT_PERMISSIONS: Record<string, readonly string[]> = {
  guest: ['read:public'],
  user: ['read:public', 'write:own', 'read:own'],
  premium: ['read:public', 'write:own', 'read:own', 'access:ai', 'access:alerts'],
  merchant: ['read:public', 'write:own', 'read:own', 'manage:products'],
  admin: ['*'],
};

/**
 * Pure permission check. `granted` is the role's permission list
 * as read from `roles.permissions` (or the seeded default when the
 * DB value is unavailable). Rules, in order:
 * 1. `admin` grants everything (the seeded `['*']` says so too).
 * 2. `'*'` in the granted list grants everything.
 * 3. Otherwise the exact permission string must be present.
 * Anything else — unknown role, empty list, missing value — is
 * denied. Never throws.
 */
export function hasPermission(
  roleName: string | null | undefined,
  permission: string,
  granted?: readonly string[] | null
): boolean {
  if (!roleName || !permission) return false;
  if (roleName === 'admin') return true;
  const list = granted ?? ROLE_DEFAULT_PERMISSIONS[roleName] ?? [];
  if (list.includes('*')) return true;
  return list.includes(permission);
}

/** PostgREST select fragment resolving role name + permissions. */
export const PROFILE_ROLE_PERMISSIONS_SELECT = 'role_id, roles ( name, permissions )';

export interface RolePermissions {
  roleName: string;
  permissions: string[];
}

/**
 * Parse a `roles.permissions` JSONB value into a string array.
 * The column is seeded as a JSON array of strings; tolerate a
 * single string, null, or garbage by returning [] (deny) — a
 * malformed permissions value must never become a grant.
 */
export function parseRolePermissions(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  if (typeof value === 'string') return [value];
  return [];
}

/**
 * Fetch one user's role name + permissions via the service-role
 * client. Returns null on any DB error or missing profile so
 * callers fail closed — never a default that grants access.
 */
export async function fetchRolePermissions(
  client: AnySupabaseClient,
  userId: string
): Promise<RolePermissions | null> {
  const { data, error } = await client
    .from('profiles')
    .select(PROFILE_ROLE_PERMISSIONS_SELECT)
    .eq('id', userId)
    .single();
  if (error || !data) return null;
  const row = data as unknown as {
    roles?: { name?: string | null; permissions?: unknown } | Array<{ name?: string | null; permissions?: unknown }> | null;
  };
  const roles = row.roles;
  const first = Array.isArray(roles) ? roles[0] : roles;
  const name = typeof first?.name === 'string' && first.name.length > 0 ? first.name : 'user';
  return { roleName: name, permissions: parseRolePermissions(first?.permissions) };
}

/**
 * API guard: authenticated session + role + one permission.
 * Returns `{ userId, roleName }` on success, or an error response
 * on failure. Fail closed at every step: no session, no service
 * client, no profile, or a role without the permission all return
 * an error response — never the user ID. Admins pass every
 * permission; the merchant role passes `manage:products` only
 * (its seeded permission).
 *
 * Use in place of `requireAdmin` on mutating admin routes whose
 * operation maps to a permission. Read-only admin routes keep
 * `requireAdmin` (no permission is defined for reads).
 */
export async function requirePermission(
  request: NextRequest,
  permission: AdminPermission
): Promise<
  | { userId: string; roleName: string }
  | { error: ReturnType<typeof unauthorized> | ReturnType<typeof forbidden> | ReturnType<typeof internalError> }
> {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth;

  const service = createSupabaseServiceClient();
  if (!service) {
    return { error: internalError('Admin check unavailable') };
  }

  const role = await fetchRolePermissions(service, auth.userId);
  if (!role) {
    return { error: forbidden('Admin access required') };
  }
  if (!hasPermission(role.roleName, permission, role.permissions)) {
    return { error: forbidden('Admin access required') };
  }
  return { userId: auth.userId, roleName: role.roleName };
}
