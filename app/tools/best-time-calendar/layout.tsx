/**
 * Per-tool metadata (Section 16, item 13).
 *
 * Best time to buy used to share the generic /tools hub metadata
 * (app/tools/layout.tsx). Title/description come from the
 * page's own heading and intro copy. The metadata lives here
 * — not in page.tsx — because the page is a client component
 * ('use client'), which cannot export metadata.
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Best time to buy — SmartBuy AI',
  description: 'For each category, the months when recorded prices were lowest — from real recorded price history only. Ranges, not exact dates, and no future price is promised.',
  alternates: {
    canonical: `${appConfig.url}/tools/best-time-calendar`,
  },
  openGraph: {
    title: 'Best time to buy — SmartBuy AI',
    description: 'For each category, the months when recorded prices were lowest — from real recorded price history only. Ranges, not exact dates, and no future price is promised.',
    url: `${appConfig.url}/tools/best-time-calendar`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Best time to buy — SmartBuy AI',
    description: 'For each category, the months when recorded prices were lowest — from real recorded price history only. Ranges, not exact dates, and no future price is promised.',
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
