/**
 * Metadata layout for /compare (Section 13, Chunk E).
 *
 * The page is a 'use client' component and cannot export
 * metadata itself, so this layout carries it — same pattern as
 * the other metadata wrappers. Brand suffix is "SmartBuy AI".
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Product Comparison \u2014 SmartBuy AI',
  description:
    'Compare products across retailers with deterministic, rule-based insights \u2014 real recorded prices and price history only.',
  alternates: {
    canonical: `${appConfig.url}/compare`,
  },
  openGraph: {
    title: 'Product Comparison \u2014 SmartBuy AI',
    description:
      'Compare products across retailers with deterministic, rule-based insights \u2014 real recorded prices and price history only.',
    url: `${appConfig.url}/compare`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Product Comparison \u2014 SmartBuy AI',
    description:
      'Compare products across retailers with deterministic, rule-based insights \u2014 real recorded prices and price history only.',
  },
};

export default function CompareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
