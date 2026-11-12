/**
 * Per-tool metadata (Section 16, item 13).
 *
 * Savings dashboard used to share the generic /tools hub metadata
 * (app/tools/layout.tsx). Title/description come from the
 * page's own heading and intro copy. The metadata lives here
 * — not in page.tsx — because the page is a client component
 * ('use client'), which cannot export metadata.
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Savings dashboard — SmartBuy AI',
  description: 'How much you have actually saved — from confirmed savings only. Every figure is computed from your recorded savings ledger at read time.',
  alternates: {
    canonical: `${appConfig.url}/tools/savings-dashboard`,
  },
  openGraph: {
    title: 'Savings dashboard — SmartBuy AI',
    description: 'How much you have actually saved — from confirmed savings only. Every figure is computed from your recorded savings ledger at read time.',
    url: `${appConfig.url}/tools/savings-dashboard`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Savings dashboard — SmartBuy AI',
    description: 'How much you have actually saved — from confirmed savings only. Every figure is computed from your recorded savings ledger at read time.',
  },
};

export default function ToolLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // JSX return (same pattern as app/admin/layout.tsx): returning
  // children bare trips TS1062 under `next build` route-type
  // checking — the fragment infers Promise<JSX.Element>.
  return <>{children}</>;
}
