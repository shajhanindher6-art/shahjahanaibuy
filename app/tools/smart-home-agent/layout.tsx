/**
 * Per-tool metadata (Section 16, item 13).
 *
 * AI Smart Home Reorder Agent used to share the generic /tools hub metadata
 * (app/tools/layout.tsx). Title/description come from the
 * page's own heading and intro copy. The metadata lives here
 * — not in page.tsx — because the page is a client component
 * ('use client'), which cannot export metadata.
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'AI Smart Home Reorder Agent — SmartBuy AI',
  description: 'When an IoT device reports it is running low, the matching rule prepares a reorder — as a pending confirmation. The agent never places an order by itself.',
  alternates: {
    canonical: `${appConfig.url}/tools/smart-home-agent`,
  },
  openGraph: {
    title: 'AI Smart Home Reorder Agent — SmartBuy AI',
    description: 'When an IoT device reports it is running low, the matching rule prepares a reorder — as a pending confirmation. The agent never places an order by itself.',
    url: `${appConfig.url}/tools/smart-home-agent`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'AI Smart Home Reorder Agent — SmartBuy AI',
    description: 'When an IoT device reports it is running low, the matching rule prepares a reorder — as a pending confirmation. The agent never places an order by itself.',
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
