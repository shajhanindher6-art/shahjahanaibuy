'use client';

import { DashboardSidebar } from '@/components/layout/dashboard-sidebar';
import { DashboardHeader } from '@/components/layout/dashboard-header';
import { ProtectedRoute } from '@/features/auth/protected-route';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
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
