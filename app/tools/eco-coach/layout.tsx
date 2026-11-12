/**
 * Per-tool metadata (Section 16, item 13).
 *
 * AI Eco Shopping Coach used to share the generic /tools hub metadata
 * (app/tools/layout.tsx). Title/description come from the
 * page's own heading and intro copy. The metadata lives here
 * — not in page.tsx — because the page is a client component
 * ('use client'), which cannot export metadata.
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'AI Eco Shopping Coach — SmartBuy AI',
  description: 'Set a monthly carbon budget and see how your month is going. Recorded carbon counts first; anything estimated is labeled as an estimate.',
  alternates: {
    canonical: `${appConfig.url}/tools/eco-coach`,
  },
  openGraph: {
    title: 'AI Eco Shopping Coach — SmartBuy AI',
    description: 'Set a monthly carbon budget and see how your month is going. Recorded carbon counts first; anything estimated is labeled as an estimate.',
    url: `${appConfig.url}/tools/eco-coach`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'AI Eco Shopping Coach — SmartBuy AI',
    description: 'Set a monthly carbon budget and see how your month is going. Recorded carbon counts first; anything estimated is labeled as an estimate.',
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
