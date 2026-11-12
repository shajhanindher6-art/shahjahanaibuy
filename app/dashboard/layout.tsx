import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import DashboardShell from '@/components/layout/dashboard-shell';

// Section 14, Chunk 6: robots noindex — /dashboard is auth-gated
// (and disallowed in robots.txt); it is not content to index. No
// canonical or Open Graph: a gated page has no public URL to share.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

/**
 * Dashboard layout — Server Component.
 *
 * Section 15, B17: server-side auth gate, copied from
 * app/admin/layout.tsx (getUser() → redirect). The dashboard used
 * to rely on a client-side guard only, so an anonymous `curl
 * /dashboard` returned 200 and rendered the shell before the
 * client redirect fired. The APIs already enforced auth
 * server-side, so this was a UX/hygiene gap, not a data leak —
 * but the shell must not render for a visitor with no session.
 * Fail closed: no user → /sign-in, before anything renders.
 *
 * `force-dynamic` is deliberate: every /dashboard page is auth-gated, so
 * there is nothing meaningful to prerender at build time — and the
 * build-time prerender is exactly what kept failing Vercel builds
 * (Next 13 prerender race: "Could not find the module .../error-boundary.js
 * in the React Client Manifest" on the 12 auth-gated /admin + /dashboard
 * pages, e.g. commit d32ebf95). Rendering these pages per request instead
 * of at build time removes that failing step entirely. Public pages are
 * unaffected and stay statically generated.
 */
export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  return <DashboardShell>{children}</DashboardShell>;
}
