/**
 * Metadata layout for /track (Section 13, Chunk E).
 *
 * The page is a 'use client' component and cannot export
 * metadata itself, so this layout carries it — same pattern as
 * the other metadata wrappers. Brand suffix is "SmartBuy AI".
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Track this product \u2014 SmartBuy AI',
  description:
    'Find the matching product on SmartBuy from any store page, then set a price alert on its page.',
  alternates: {
    canonical: `${appConfig.url}/track`,
  },
  openGraph: {
    title: 'Track this product \u2014 SmartBuy AI',
    description:
      'Find the matching product on SmartBuy from any store page, then set a price alert on its page.',
    url: `${appConfig.url}/track`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Track this product \u2014 SmartBuy AI',
    description:
      'Find the matching product on SmartBuy from any store page, then set a price alert on its page.',
  },
};

export default function TrackLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
