/**
 * Per-tool metadata (Section 16, item 13).
 *
 * Shopping list optimizer used to share the generic /tools hub metadata
 * (app/tools/layout.tsx). Title/description come from the
 * page's own heading and intro copy. The metadata lives here
 * — not in page.tsx — because the page is a client component
 * ('use client'), which cannot export metadata.
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Shopping list optimizer — SmartBuy AI',
  description: 'Add the products on your list and see the cheapest way to buy them all — which item from which store — from real recorded merchant prices only.',
  alternates: {
    canonical: `${appConfig.url}/tools/list-optimizer`,
  },
  openGraph: {
    title: 'Shopping list optimizer — SmartBuy AI',
    description: 'Add the products on your list and see the cheapest way to buy them all — which item from which store — from real recorded merchant prices only.',
    url: `${appConfig.url}/tools/list-optimizer`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Shopping list optimizer — SmartBuy AI',
    description: 'Add the products on your list and see the cheapest way to buy them all — which item from which store — from real recorded merchant prices only.',
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
