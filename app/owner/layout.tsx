/**
 * Owner layout — server-side guard (Section 17, Stage H item 19).
 *
 * Same guard pattern as app/admin/layout.tsx (read it, do not edit
 * it): no session → /sign-in; signed in but not admin → /dashboard.
 * Fail closed: a missing service client or a missing profile also
 * redirects away, never through. The owner dashboard shows revenue
 * and subscription aggregates, so it is admin-only like /admin.
 *
 * NOTE: the role read below (profiles.role) is the same one the
 * Section 17 audit flagged (§4 #1 — the migration chain has only
 * role_id). Another Stage H worker owns that fix; this layout
 * follows the existing admin pattern deliberately so both surfaces
 * change together when the fix lands.
 */

import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

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
  if (!user) redirect('/sign-in');

  const service = createSupabaseServiceClient();
  const { data: profile } = service
    ? await service.from('profiles').select('role').eq('id', user.id).single()
    : { data: null };
  if ((profile as { role?: unknown } | null)?.role !== 'admin') {
    redirect('/dashboard');
  }

  return <>{children}</>;
}
