/**
 * Owner layout — server-side guard (Section 17, Stage H item 19).
 *
 * Same guard pattern as app/admin/layout.tsx (read it, do not edit
 * it): no session → /sign-in; signed in but not admin → /dashboard.
 * Fail closed: a missing service client or a missing profile also
 * redirects away, never through. The owner dashboard shows revenue
 * and subscription aggregates, so it is admin-only like /admin.
 *
 * NOTE (Section 18, Phase 0, audit §1 #1): the role read below used
 * to select the nonexistent `profiles.role` column (the migration
 * chain has only `role_id`), which failed closed and redirected
 * every signed-in admin to /dashboard. It now resolves the role via
 * `fetchProfileRoleName` (role_id → roles.name), exactly like
 * app/admin/layout.tsx.
 */

import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { fetchProfileRoleName } from '@/lib/admin-role';

// Robots noindex — /owner is auth-gated (and disallowed in
// robots.txt); it is not content to index. No canonical or Open
// Graph: a gated page has no public URL to share.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

/**
 * `force-dynamic`: /owner is auth-gated (admin role only), so there
 * is nothing meaningful to prerender at build time.
 */
export const dynamic = 'force-dynamic';

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?reason=session-expired');

  // Section 18, Phase 0 (audit §1 #1): the role is resolved via
  // `role_id → roles.name` — `profiles` has NO `role` column in
  // the migration chain, so selecting `role` errored and the guard
  // redirected everyone (including the real admin) to /dashboard.
  const service = createSupabaseServiceClient();
  const roleName = service ? await fetchProfileRoleName(service, user.id) : null;
  if (roleName !== 'admin') {
    redirect('/dashboard');
  }

  return <>{children}</>;
}
