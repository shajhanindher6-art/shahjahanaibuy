/**
 * Dashboard server auth-gate tests (Section 15, B17).
 *
 * The dashboard used to rely on a client-side guard only, so an
 * anonymous `curl /dashboard` returned 200 and rendered the shell
 * before the client redirect fired. The layout now enforces the
 * gate on the server, copying the app/admin/layout.tsx getUser()
 * → redirect pattern. These are static tests (same precedent as
 * tests/section14-chunk6-trust-metadata.test.ts, which asserts
 * layout content by reading the file): importing the layout in
 * the node test env would drag in the whole client shell
 * (DashboardShell → ProtectedRoute → auth provider), so the
 * behavioural check is the dev smoke (anonymous curl /dashboard
 * must redirect, not 200) — see the Section 15 W2E report.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dashboardLayout = fs.readFileSync(
  path.join(root, 'app/dashboard/layout.tsx'),
  'utf8'
);
const adminLayout = fs.readFileSync(path.join(root, 'app/admin/layout.tsx'), 'utf8');

describe('dashboard server auth-gate (Section 15, B17)', () => {
  it('checks the session server-side with getUser() before rendering', () => {
    expect(dashboardLayout).toContain('createSupabaseServerClient');
    expect(dashboardLayout).toContain('supabase.auth.getUser()');
  });

  it('redirects anonymous visitors to /sign-in (the admin pattern)', () => {
    expect(dashboardLayout).toContain("redirect('/sign-in?reason=session-expired')");
    // Same building blocks as the admin layout's gate.
    expect(adminLayout).toContain("redirect('/sign-in?reason=session-expired')");
    expect(adminLayout).toContain('supabase.auth.getUser()');
  });

  it('is an async Server Component that still renders the shell for signed-in users', () => {
    expect(dashboardLayout).toContain('export default async function DashboardLayout');
    expect(dashboardLayout).toContain('<DashboardShell>{children}</DashboardShell>');
    expect(dashboardLayout).toContain("export const dynamic = 'force-dynamic'");
  });

  it('does not add a role check — any signed-in user may use the dashboard', () => {
    // The admin layout redirects non-admins to /dashboard; the
    // dashboard gate must NOT copy that part (it would loop).
    expect(dashboardLayout).not.toContain("redirect('/dashboard')");
    expect(dashboardLayout).not.toContain('profiles');
  });
});
