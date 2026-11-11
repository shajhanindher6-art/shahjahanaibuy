/**
 * Metadata layout for /search (Section 13, Chunk E).
 *
 * The page is a 'use client' component and cannot export
 * metadata itself, so this layout carries it — same pattern as
 * the other metadata wrappers. Brand suffix is "SmartBuy AI".
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'AI Product Search \u2014 SmartBuy AI',
  description:
    'Search products in natural language \u2014 local-first retailer search with a global import tab. Real catalog prices only.',
  alternates: {
    canonical: `${appConfig.url}/search`,
  },
  openGraph: {
    title: 'AI Product Search \u2014 SmartBuy AI',
    description:
      'Search products in natural language \u2014 local-first retailer search with a global import tab. Real catalog prices only.',
    url: `${appConfig.url}/search`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'AI Product Search \u2014 SmartBuy AI',
    description:
      'Search products in natural language \u2014 local-first retailer search with a global import tab. Real catalog prices only.',
  },
};

export default function SearchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
