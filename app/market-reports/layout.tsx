/**
 * Metadata layout for /market-reports (Section 13, Chunk E).
 *
 * The page is a 'use client' component and cannot export
 * metadata itself, so this layout carries it — same pattern as
 * the other metadata wrappers. Brand suffix is "SmartBuy AI".
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Market reports \u2014 SmartBuy AI',
  description:
    'Weekly deal reports, monthly category deep-dives, and seasonal buying guides \u2014 all computed from recorded price history only.',
  alternates: {
    canonical: `${appConfig.url}/market-reports`,
  },
  openGraph: {
    title: 'Market reports \u2014 SmartBuy AI',
    description:
      'Weekly deal reports, monthly category deep-dives, and seasonal buying guides \u2014 all computed from recorded price history only.',
    url: `${appConfig.url}/market-reports`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Market reports \u2014 SmartBuy AI',
    description:
      'Weekly deal reports, monthly category deep-dives, and seasonal buying guides \u2014 all computed from recorded price history only.',
  },
};

export default function MarketReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
