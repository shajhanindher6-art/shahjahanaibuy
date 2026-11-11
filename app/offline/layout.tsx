/**
 * Metadata layout for /offline (Section 13, Chunk E).
 *
 * The page is a 'use client' component and cannot export
 * metadata itself, so this layout carries it — same pattern as
 * the other metadata wrappers. Brand suffix is "SmartBuy AI".
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'You\u2019re Offline \u2014 SmartBuy AI',
  description:
    'You appear to have lost your internet connection. Live prices, search, and alerts need the network \u2014 pages you have already visited may still open from cache.',
  alternates: {
    canonical: `${appConfig.url}/offline`,
  },
  openGraph: {
    title: 'You\u2019re Offline \u2014 SmartBuy AI',
    description:
      'You appear to have lost your internet connection. Live prices, search, and alerts need the network \u2014 pages you have already visited may still open from cache.',
    url: `${appConfig.url}/offline`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'You\u2019re Offline \u2014 SmartBuy AI',
    description:
      'You appear to have lost your internet connection. Live prices, search, and alerts need the network \u2014 pages you have already visited may still open from cache.',
  },
};

export default function OfflineLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
