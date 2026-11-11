/**
 * Metadata layout for /tools/store-finder (Section 12).
 *
 * The Store Finder page is a 'use client' component and cannot
 * export metadata itself, so this layout carries it — same pattern
 * as the other metadata wrappers. Brand suffix is "SmartBuy AI".
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Store Finder — SmartBuy AI',
  description:
    'Find which stores in your country carry a product, with a search link to each store. Directory and search links only — no invented prices or shipping claims.',
  alternates: {
    canonical: `${appConfig.url}/tools/store-finder`,
  },
  openGraph: {
    title: 'Store Finder — SmartBuy AI',
    description:
      'Find which stores in your country carry a product, with a search link to each store. Directory and search links only — no invented prices or shipping claims.',
    url: `${appConfig.url}/tools/store-finder`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Store Finder — SmartBuy AI',
    description:
      'Find which stores in your country carry a product, with a search link to each store. Directory and search links only — no invented prices or shipping claims.',
  },
};

export default function StoreFinderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
