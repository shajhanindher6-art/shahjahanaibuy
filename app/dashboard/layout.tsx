import type { Metadata } from 'next';
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

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
