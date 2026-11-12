/**
 * Per-tool metadata (Section 16, item 13).
 *
 * Price-drop digest used to share the generic /tools hub metadata
 * (app/tools/layout.tsx). Title/description come from the
 * page's own heading and intro copy. The metadata lives here
 * — not in page.tsx — because the page is a client component
 * ('use client'), which cannot export metadata.
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Price-drop digest — SmartBuy AI',
  description: 'One summary of the price drops on the products you watch — top deals first, with one line per deal explaining why it is a deal.',
  alternates: {
    canonical: `${appConfig.url}/tools/price-drop-digest`,
  },
  openGraph: {
    title: 'Price-drop digest — SmartBuy AI',
    description: 'One summary of the price drops on the products you watch — top deals first, with one line per deal explaining why it is a deal.',
    url: `${appConfig.url}/tools/price-drop-digest`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Price-drop digest — SmartBuy AI',
    description: 'One summary of the price drops on the products you watch — top deals first, with one line per deal explaining why it is a deal.',
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
