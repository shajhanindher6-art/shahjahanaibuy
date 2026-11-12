/**
 * Per-tool metadata (Section 16, item 13).
 *
 * Store Finder used to share the generic /tools hub metadata
 * (app/tools/layout.tsx). Title/description come from the
 * page's own heading and intro copy. The metadata lives here
 * — not in page.tsx — because the page is a client component
 * ('use client'), which cannot export metadata.
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Store Finder — SmartBuy AI',
  description: 'Find the stores in your country, then search a product on their own site. Search links only — SmartBuy does not show their prices or stock.',
  alternates: {
    canonical: `${appConfig.url}/tools/store-finder`,
  },
  openGraph: {
    title: 'Store Finder — SmartBuy AI',
    description: 'Find the stores in your country, then search a product on their own site. Search links only — SmartBuy does not show their prices or stock.',
    url: `${appConfig.url}/tools/store-finder`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Store Finder — SmartBuy AI',
    description: 'Find the stores in your country, then search a product on their own site. Search links only — SmartBuy does not show their prices or stock.',
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
