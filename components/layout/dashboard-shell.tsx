'use client';

import { DashboardSidebar } from '@/components/layout/dashboard-sidebar';
import { DashboardHeader } from '@/components/layout/dashboard-header';
import { ProtectedRoute } from '@/features/auth/protected-route';

/**
 * Dashboard shell — client-side frame (sidebar + header + auth guard).
 *
 * Split out of app/dashboard/layout.tsx so the layout itself can stay a
 * Server Component and carry `export const dynamic = 'force-dynamic'`
 * (route segment config is not allowed in a 'use client' file).
 * Behaviour is identical to the old layout; only the file boundary moved.
 */
export default function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <div className="flex min-h-screen">
        {/* Desktop sidebar */}
        <aside className="hidden w-64 border-r md:block">
          <div className="sticky top-0 h-screen">
            <DashboardSidebar />
          </div>
        </aside>
        {/* Main content */}
        <div className="flex flex-1 flex-col">
          <DashboardHeader />
          <main className="flex-1 bg-muted/30 p-4 md:p-8">{children}</main>
        </div>
      </div>
    </ProtectedRoute>
  );
}
