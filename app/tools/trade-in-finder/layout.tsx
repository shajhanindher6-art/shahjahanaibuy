/**
 * Per-tool metadata (Section 16, item 13).
 *
 * Trade-in & second-hand finder used to share the generic /tools hub metadata
 * (app/tools/layout.tsx). Title/description come from the
 * page's own heading and intro copy. The metadata lives here
 * — not in page.tsx — because the page is a client component
 * ('use client'), which cannot export metadata.
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Trade-in & second-hand finder — SmartBuy AI',
  description: 'Before buying new, see what your old product is worth and where you can trade it in. Trade-in programs are listed only when a real program is confirmed.',
  alternates: {
    canonical: `${appConfig.url}/tools/trade-in-finder`,
  },
  openGraph: {
    title: 'Trade-in & second-hand finder — SmartBuy AI',
    description: 'Before buying new, see what your old product is worth and where you can trade it in. Trade-in programs are listed only when a real program is confirmed.',
    url: `${appConfig.url}/tools/trade-in-finder`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Trade-in & second-hand finder — SmartBuy AI',
    description: 'Before buying new, see what your old product is worth and where you can trade it in. Trade-in programs are listed only when a real program is confirmed.',
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
