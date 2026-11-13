/**
 * Server-component admin guard (Final 100%, F-P1-62).
 *
 * Service-role reads in server components used to be guarded ONLY
 * by `app/admin/layout.tsx` / `app/owner/layout.tsx` — no role
 * re-check happened in the page itself, so a layout change (or a
 * page rendered outside its layout) would expose the data. Every
 * admin/owner server page now calls `requireAdminPage()` as its
 * first statement, exactly like `app/admin/users/page.tsx` already
 * did: getUser() + role + permissions re-check, fail-closed.
 *
 * Behaviour matches the layouts: no session → /sign-in; signed in
 * but not admin (or admin-named without '*' / 'admin:access'
 * permissions — F-P1-61) → /dashboard; missing service client →
 * /dashboard (never through). Returns the authenticated admin's
 * user id for callers that need it.
 *
 * Client components (app/admin/page.tsx, the intake pages) cannot
 * call this — they render under the layout guard and check the
 * client-side role; that limitation is documented, not hidden.
 */
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { fetchProfileRoleWithPermissions } from '@/lib/admin-role';

export async function requireAdminPage(): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?reason=session-expired');

  const service = createSupabaseServiceClient();
  const role = service ? await fetchProfileRoleWithPermissions(service, user.id) : null;
  if (
    !role ||
    role.roleName !== 'admin' ||
    !(role.permissions.includes('*') || role.permissions.includes('admin:access'))
  ) {
    redirect('/dashboard');
  }
  return user.id;
}
