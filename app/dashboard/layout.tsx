import DashboardShell from '@/components/layout/dashboard-shell';

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
