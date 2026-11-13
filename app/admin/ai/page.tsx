/**
 * AI admin control center (Section 19, Phase 7, §12 #71 + #73).
 *
 * READ-ONLY v1: provider status, usage, prediction accuracy and the
 * AI error breakdown. No writes, no provider-config surface.
 * Guard: /admin/layout.tsx redirects non-admins server-side before
 * this page renders; the data route enforces requireAdmin too.
 */

import type { Metadata } from 'next';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { AiControlCenter } from '@/components/admin/ai-control-center';
import { requireAdminPage } from '@/lib/admin-page-guard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AI control center — Admin — SmartBuy AI',
  description:
    'Read-only AI control center: provider status, AI usage, prediction accuracy and the AI error breakdown. Admin only.',
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AdminAiPage() {
  // Final 100%, F-P1-62 — per-page server-side admin re-check
  // (the layout guard alone is not the only check anymore).
  await requireAdminPage();
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-bold">AI control center</h1>
          <p className="mt-2 text-muted-foreground">
            Provider status, usage, prediction accuracy and AI errors — read
            only. Nothing on this page changes any setting: provider
            configuration is an owner action in the dashboards, not a button
            here.
          </p>
          <div className="mt-6">
            <AiControlCenter />
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
