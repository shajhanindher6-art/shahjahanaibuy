/**
 * Admin layout — server-side guard.
 *
 * The admin page used to rely on a client-side role check, so the
 * shell rendered for everyone and only the data calls decided what
 * a visitor could see. This layout enforces it on the server before
 * anything renders: no session → /sign-in; signed in but not admin
 * → /dashboard. Fail closed: a missing service client or a missing
 * profile also redirects away, never through.
 */

import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { fetchProfileRoleName } from '@/lib/admin-role';

// Section 14, Chunk 6: robots noindex — /admin is auth-gated (and
// disallowed in robots.txt); it is not content to index. No
// canonical or Open Graph: a gated page has no public URL to share.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

/**
 * `force-dynamic`: /admin is auth-gated (admin role only), so there is
 * nothing meaningful to prerender at build time — and the build-time
 * prerender is exactly what kept failing Vercel builds (Next 13
 * prerender race on the 12 auth-gated /admin + /dashboard pages,
 * e.g. commit d32ebf95). Rendering per request removes that step.
 */
export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?reason=session-expired');

  // Section 17, Stage H, item 7 (audit §4 #1): the role is resolved
  // via `role_id → roles.name` — `profiles` has NO `role` column in
  // the migration chain, so selecting `role` errored and the guard
  // redirected everyone (including the real admin) to /dashboard.
  const service = createSupabaseServiceClient();
  const roleName = service ? await fetchProfileRoleName(service, user.id) : null;
  if (roleName !== 'admin') {
    redirect('/dashboard');
  }

  return <>{children}</>;
}
