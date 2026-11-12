/**
 * Per-tool metadata (Section 16, item 13).
 *
 * Monthly shopping planner used to share the generic /tools hub metadata
 * (app/tools/layout.tsx). Title/description come from the
 * page's own heading and intro copy. The metadata lives here
 * — not in page.tsx — because the page is a client component
 * ('use client'), which cannot export metadata.
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Monthly shopping planner — SmartBuy AI',
  description: 'Set a monthly budget and the products you are considering. The planner uses the Buy vs Wait engine on recorded price history — buy now, wait for a drop, or move it to next month.',
  alternates: {
    canonical: `${appConfig.url}/tools/monthly-planner`,
  },
  openGraph: {
    title: 'Monthly shopping planner — SmartBuy AI',
    description: 'Set a monthly budget and the products you are considering. The planner uses the Buy vs Wait engine on recorded price history — buy now, wait for a drop, or move it to next month.',
    url: `${appConfig.url}/tools/monthly-planner`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Monthly shopping planner — SmartBuy AI',
    description: 'Set a monthly budget and the products you are considering. The planner uses the Buy vs Wait engine on recorded price history — buy now, wait for a drop, or move it to next month.',
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
