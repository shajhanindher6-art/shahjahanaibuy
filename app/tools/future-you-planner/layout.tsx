/**
 * Per-tool metadata (Section 16, item 13).
 *
 * Future You planner used to share the generic /tools hub metadata
 * (app/tools/layout.tsx). Title/description come from the
 * page's own heading and intro copy. The metadata lives here
 * — not in page.tsx — because the page is a client component
 * ('use client'), which cannot export metadata.
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Future You planner — SmartBuy AI',
  description: 'Saving for a big purchase? Set the target and the date, and the planner says how much to save each month: (target − saved so far) ÷ months remaining.',
  alternates: {
    canonical: `${appConfig.url}/tools/future-you-planner`,
  },
  openGraph: {
    title: 'Future You planner — SmartBuy AI',
    description: 'Saving for a big purchase? Set the target and the date, and the planner says how much to save each month: (target − saved so far) ÷ months remaining.',
    url: `${appConfig.url}/tools/future-you-planner`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Future You planner — SmartBuy AI',
    description: 'Saving for a big purchase? Set the target and the date, and the planner says how much to save each month: (target − saved so far) ÷ months remaining.',
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
