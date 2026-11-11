/**
 * Metadata layout for /gifts (Section 13, Chunk E).
 *
 * The page is a 'use client' component and cannot export
 * metadata itself, so this layout carries it — same pattern as
 * the other metadata wrappers. Brand suffix is "SmartBuy AI".
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Gift Finder \u2014 SmartBuy AI',
  description:
    'Tell us the occasion, budget, recipient\u2019s country and interests, and we\u2019ll match real catalog products with real prices, deals, and stores.',
  alternates: {
    canonical: `${appConfig.url}/gifts`,
  },
  openGraph: {
    title: 'Gift Finder \u2014 SmartBuy AI',
    description:
      'Tell us the occasion, budget, recipient\u2019s country and interests, and we\u2019ll match real catalog products with real prices, deals, and stores.',
    url: `${appConfig.url}/gifts`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Gift Finder \u2014 SmartBuy AI',
    description:
      'Tell us the occasion, budget, recipient\u2019s country and interests, and we\u2019ll match real catalog products with real prices, deals, and stores.',
  },
};

export default function GiftsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
