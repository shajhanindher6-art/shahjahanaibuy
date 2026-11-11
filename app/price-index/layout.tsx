/**
 * Metadata layout for /price-index (Section 13, Chunk E).
 *
 * The page is a 'use client' component and cannot export
 * metadata itself, so this layout carries it — same pattern as
 * the other metadata wrappers. Brand suffix is "SmartBuy AI".
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'SmartBuy Price Index \u2014 SmartBuy AI',
  description:
    'A monthly price index per category and region, computed only from recorded price history. The base month is 100.',
  alternates: {
    canonical: `${appConfig.url}/price-index`,
  },
  openGraph: {
    title: 'SmartBuy Price Index \u2014 SmartBuy AI',
    description:
      'A monthly price index per category and region, computed only from recorded price history. The base month is 100.',
    url: `${appConfig.url}/price-index`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'SmartBuy Price Index \u2014 SmartBuy AI',
    description:
      'A monthly price index per category and region, computed only from recorded price history. The base month is 100.',
  },
};

export default function PriceIndexLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
