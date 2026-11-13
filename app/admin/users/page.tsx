/**
 * Admin users list (Sections 21–25, Stage G, G-P1-1) — /admin/users.
 *
 * READ-ONLY BY DESIGN: this page lists users and their roles. It
 * has NO role-changing UI — changing a role is owner-gated
 * (migration 047 unapplied) and out of scope here.
 *
 * Guard (server-side, never frontend-only hiding): /admin/layout.tsx
 * redirects non-admins before this page renders, and this page
 * repeats the same check itself (defense in depth) — getUser() +
 * fetchProfileRoleName() + redirect — before it reads anything.
 * The data service gets the authenticated admin id too, so
 * getAllUsers re-checks the role via assertAdminServiceAccess
 * before touching `profiles`. The API route behind the same data
 * (GET /api/v1/admin/users) enforces `requireAdmin`.
 *
 * Data: the existing admin service `getAllUsers` (services/admin.ts)
 * — the same source the API route uses. No new data source, no new
 * query. Only safe fields are rendered (display name, email, role,
 * joined date). Credential material of any kind is NEVER rendered:
 * the service never selects it, and this page does not add any.
 *
 * Honesty: when there are no users — or the profiles read fails —
 * the page shows an honest empty state. Rows are never invented.
 *
 * All copy is literal English — no i18n keys are added for admin
 * surfaces.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { fetchProfileRoleName } from '@/lib/admin-role';
import { getAllUsers } from '@/services/admin';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Users — Admin — SmartBuy AI',
  description: 'All registered users and their roles. Read-only. Admin only.',
  robots: {
    index: false,
    follow: false,
  },
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Only the safe fields getAllUsers returns are rendered. */
interface SafeUserRow {
  email: string;
  fullName: string;
  role: string;
  createdAt: string | null;
}

function toSafeUserRow(row: Record<string, unknown>): SafeUserRow {
  const email = typeof row.email === 'string' ? row.email : '';
  const fullName =
    typeof row.full_name === 'string' && row.full_name.length > 0
      ? row.full_name
      : email;
  const role = typeof row.role === 'string' ? row.role : 'user';
  const createdAt =
    typeof row.created_at === 'string' ? row.created_at : null;
  return { email, fullName, role, createdAt };
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  // Server-side guard (defense in depth — the layout already
  // redirects non-admins, but this page never trusts that alone).
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?reason=session-expired');

  const service = createSupabaseServiceClient();
  if (!service) redirect('/dashboard');
  const roleName = await fetchProfileRoleName(service, user.id);
  if (roleName !== 'admin') redirect('/dashboard');

  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);
  const result = await getAllUsers(service, page, 20, {
    adminUserId: user.id,
  });
  const users = result.users.map((row) =>
    toSafeUserRow(row as Record<string, unknown>)
  );

  return (
    <main className="container mx-auto max-w-6xl px-4 py-12">
      <h1 className="text-3xl font-bold">Users</h1>
      <p className="mt-2 text-muted-foreground">
        {result.total} user(s) registered, newest first. Read-only —
        roles cannot be changed here.
      </p>

      {users.length === 0 ? (
        <div className="mt-6 rounded-lg border p-6">
          <p className="font-medium">No users found.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            No accounts are registered yet, or the profiles list could
            not be read. Users appear here as accounts are created —
            no rows are invented to fill the list.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {users.map((listed, index) => (
            <section
              key={`${listed.email || 'unknown'}-${index}`}
              className="rounded-lg border p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{listed.fullName}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {listed.email}
                  </p>
                </div>
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
                  {listed.role}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Joined {formatDateTime(listed.createdAt)}
              </p>
            </section>
          ))}
        </div>
      )}

      {result.total > result.pageSize ? (
        <nav aria-label="User pages" className="mt-6 flex flex-wrap gap-2">
          {page > 1 ? (
            <Link
              href={`/admin/users?page=${page - 1}`}
              className="rounded-lg border px-4 py-2 text-sm font-medium"
            >
              Previous page
            </Link>
          ) : null}
          <span className="px-2 py-2 text-sm text-muted-foreground">
            Page {result.page} of{' '}
            {Math.max(1, Math.ceil(result.total / result.pageSize))}
          </span>
          {page * result.pageSize < result.total ? (
            <Link
              href={`/admin/users?page=${page + 1}`}
              className="rounded-lg border px-4 py-2 text-sm font-medium"
            >
              Next page
            </Link>
          ) : null}
        </nav>
      ) : null}
    </main>
  );
}
