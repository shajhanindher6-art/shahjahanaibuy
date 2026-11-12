/**
 * Section 17, Stage H — admin role resolution + self-promotion guard.
 *
 * Item 7 (audit §4 #1): the admin role is resolved via
 * `role_id → roles.name` — `profiles` has NO `role` column in the
 * migration chain, so the old `.select('role')` errored and every
 * admin check failed closed. Covers the pure resolver, the fetch
 * helper (mocked client), and `getAllUsers` role mapping.
 *
 * Item 8 (audit §4 #2): migration 047's trigger blocks row-owner
 * `role_id` changes — file assertions only (SQL is never executed
 * here; applying is an owner step).
 *
 * Item 13 (audit §4 #9/#10): 028 upload folder-scoping + 043 UPDATE
 * policy — file assertions.
 *
 * Item 29 (audit §4 #12): analytics_events anon INSERT is KEPT by
 * conscious decision — file assertion that the decision is
 * documented in 011.
 *
 * No DB, no network: Supabase clients are mocked.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  resolveRoleName,
  isAdminRoleRow,
  fetchProfileRoleName,
  PROFILE_ROLE_SELECT,
  type ProfileRoleRow,
} from '@/lib/admin-role';
import { getAllUsers } from '@/services/admin';

const repoRoot = process.cwd();
function read(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

// --- Item 7: pure resolver --------------------------------------------

describe('resolveRoleName (role_id → roles.name)', () => {
  it('returns the joined roles.name', () => {
    expect(resolveRoleName({ role_id: 'r1', roles: { name: 'admin' } })).toBe('admin');
    expect(resolveRoleName({ role_id: 'r2', roles: { name: 'user' } })).toBe('user');
    expect(resolveRoleName({ role_id: 'r3', roles: { name: 'premium' } })).toBe('premium');
  });

  it('defaults to user when the join is empty or missing — never admin', () => {
    expect(resolveRoleName(null)).toBe('user');
    expect(resolveRoleName(undefined)).toBe('user');
    expect(resolveRoleName({})).toBe('user');
    expect(resolveRoleName({ role_id: null, roles: null })).toBe('user');
    expect(resolveRoleName({ role_id: 'r1', roles: { name: null } })).toBe('user');
    expect(resolveRoleName({ role_id: 'r1', roles: { name: '' } })).toBe('user');
  });

  it('tolerates the array embed shape (first element wins)', () => {
    expect(resolveRoleName({ roles: [{ name: 'admin' }] } as ProfileRoleRow)).toBe('admin');
    expect(resolveRoleName({ roles: [] } as ProfileRoleRow)).toBe('user');
  });
});

describe('isAdminRoleRow', () => {
  it('is true only for exactly admin', () => {
    expect(isAdminRoleRow({ roles: { name: 'admin' } })).toBe(true);
    expect(isAdminRoleRow({ roles: { name: 'user' } })).toBe(false);
    expect(isAdminRoleRow({ roles: { name: 'Admin' } })).toBe(false);
    expect(isAdminRoleRow(null)).toBe(false);
    expect(isAdminRoleRow({})).toBe(false);
  });
});

// --- Item 7: fetch helper (mocked client) ------------------------------

function mockSingleClient(result: { data: unknown; error: unknown }) {
  const single = vi.fn(async () => result);
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { from } as any, from, select, eq, single };
}

describe('fetchProfileRoleName', () => {
  it('selects the roles join and returns the admin name', async () => {
    const { client, select } = mockSingleClient({
      data: { role_id: 'r1', roles: { name: 'admin' } },
      error: null,
    });
    await expect(fetchProfileRoleName(client, 'u-1')).resolves.toBe('admin');
    expect(select).toHaveBeenCalledWith(PROFILE_ROLE_SELECT);
    expect(PROFILE_ROLE_SELECT).toContain('roles');
    expect(PROFILE_ROLE_SELECT).not.toContain("'role'");
  });

  it('returns null (fail closed) on DB error or missing profile', async () => {
    const errClient = mockSingleClient({ data: null, error: { message: 'boom' } });
    await expect(fetchProfileRoleName(errClient.client, 'u-1')).resolves.toBeNull();
    const missingClient = mockSingleClient({ data: null, error: null });
    await expect(fetchProfileRoleName(missingClient.client, 'u-1')).resolves.toBeNull();
  });

  it('returns user for a non-admin join', async () => {
    const { client } = mockSingleClient({
      data: { role_id: 'r2', roles: { name: 'user' } },
      error: null,
    });
    await expect(fetchProfileRoleName(client, 'u-1')).resolves.toBe('user');
  });
});

// --- Item 7: getAllUsers maps the join to a flat role string -----------

describe('getAllUsers role mapping', () => {
  function mockListClient(rows: unknown[], error: unknown = null) {
    const range = vi.fn(async () => ({ data: rows, error, count: rows.length }));
    const order = vi.fn(() => ({ range }));
    const select = vi.fn(() => ({ order }));
    const from = vi.fn(() => ({ select }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { client: { from } as any, select };
  }

  it('resolves roles.name into a flat role string and drops the nested embed', async () => {
    const { client, select } = mockListClient([
      { id: 'u-1', email: 'a@x.com', role_id: 'r1', roles: { name: 'admin' } },
      { id: 'u-2', email: 'b@x.com', role_id: 'r2', roles: { name: 'user' } },
      { id: 'u-3', email: 'c@x.com', role_id: null, roles: null },
    ]);
    const result = await getAllUsers(client, 1, 20);
    expect(result.total).toBe(3);
    expect(result.users[0].role).toBe('admin');
    expect(result.users[1].role).toBe('user');
    expect(result.users[2].role).toBe('user');
    expect(result.users[0]).not.toHaveProperty('roles');
    expect(String((select.mock.calls[0] as unknown[])[0])).toContain('roles ( name )');
    expect(String((select.mock.calls[0] as unknown[])[0])).not.toMatch(/(^|, )role(,|$)/);
  });

  it('returns an empty list on query error', async () => {
    const { client } = mockListClient([], { message: 'boom' });
    const result = await getAllUsers(client, 1, 20);
    expect(result).toEqual({ users: [], total: 0, page: 1, pageSize: 20 });
  });
});

// --- Item 7: code + SQL file assertions ---------------------------------

describe('item 7 file assertions', () => {
  it('no server code selects a bare profiles.role column anymore', () => {
    for (const rel of ['lib/api/middleware.ts', 'app/admin/layout.tsx', 'services/admin.ts']) {
      expect(read(rel)).not.toContain(".select('role')");
    }
    expect(read('lib/api/middleware.ts')).toContain('PROFILE_ROLE_SELECT');
    expect(read('app/admin/layout.tsx')).toContain('fetchProfileRoleName');
    expect(read('services/admin.ts')).toContain('roles ( name )');
  });

  it('is_admin() in 017 joins roles instead of reading profiles.role', () => {
    const sql = read('supabase/migrations/20261105190000_017_admin_only_catalog_writes.sql');
    // Scope to the function body: the header comments legitimately
    // describe the OLD buggy read (`profiles.role = 'admin'`) as
    // history, so the assertion must not match the whole file.
    const fnStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.is_admin()');
    const fnEnd = sql.indexOf('$$;', fnStart);
    const fnBody = sql.slice(fnStart, fnEnd);
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnBody).toContain('JOIN public.roles r ON r.id = p.role_id');
    expect(fnBody).toContain("r.name = 'admin'");
    expect(fnBody).not.toContain("role = 'admin'");
    expect(fnBody).not.toContain('profiles.role');
  });

  it('the item-7 dependency flag is written in the helper and in 017', () => {
    expect(read('lib/admin-role.ts')).toContain('DEPENDENCY FLAG');
    expect(read('supabase/migrations/20261105190000_017_admin_only_catalog_writes.sql')).toContain(
      'DEPENDENCY FLAG'
    );
  });
});

// --- Item 8: migration 047 ----------------------------------------------

describe('item 8 — migration 047 role_id guard', () => {
  const rel = 'supabase/migrations/20261112180000_047_profiles_role_id_change_guard.sql';

  it('exists and is marked DO NOT APPLY YET (written, never applied)', () => {
    expect(existsSync(join(repoRoot, rel))).toBe(true);
    expect(read(rel)).toContain('DO NOT APPLY YET');
  });

  it('blocks role_id changes with a trigger that raises', () => {
    const sql = read(rel);
    expect(sql).toContain('BEFORE UPDATE ON profiles');
    expect(sql).toContain('OLD.role_id IS DISTINCT FROM NEW.role_id');
    expect(sql).toContain('RAISE EXCEPTION');
    expect(sql).toContain('prevent_profiles_role_id_change');
  });

  it('exempts only the SQL Editor (postgres) and the service-role client', () => {
    const sql = read(rel);
    expect(sql).toContain("'postgres', 'service_role'");
  });
});

// --- Item 13: 028 + 043 --------------------------------------------------

describe('item 13 — 028 storage scoping + 043 UPDATE policy', () => {
  it('028 upload policy is folder-scoped like the delete policy', () => {
    const sql = read('supabase/migrations/20261110104000_028_trust_qa.sql');
    const upload = sql.slice(sql.indexOf('review-photos authenticated upload'));
    expect(upload).toContain("(storage.foldername(name))[1] = auth.uid()::text");
    expect(sql).toContain('Section 17, Stage H, item 13');
  });

  it('043 now has an own-only FOR UPDATE policy', () => {
    const sql = read('supabase/migrations/20261112121000_043_saved_calculations.sql');
    expect(sql).toContain('saved_calculations_update_own');
    expect(sql).toContain('FOR UPDATE TO authenticated');
    expect(sql).toContain('USING (auth.uid() = user_id)');
    expect(sql).toContain('WITH CHECK (auth.uid() = user_id)');
  });
});

// --- Item 29: analytics_events KEEP decision -----------------------------

describe('item 29 — analytics_events decision', () => {
  it('011 documents the conscious KEEP of the anon INSERT policy', () => {
    const sql = read(
      'supabase/migrations/20260712070303_011_security_fix_rls_policies_part2.sql.sql'
    );
    expect(sql).toContain('CONSCIOUS DECISION: KEEP');
    expect(sql).toContain('insert_analytics_events');
    expect(sql).toContain('FOR INSERT TO anon, authenticated');
    expect(sql).toContain('WITH CHECK (event_type IS NOT NULL)');
  });

  it('no 048 migration was created (KEEP needs no new file)', () => {
    expect(existsSync(join(repoRoot, 'supabase/migrations/20261112180000_048_analytics_events.sql'))).toBe(
      false
    );
  });
});
