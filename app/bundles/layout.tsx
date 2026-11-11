/**
 * Metadata layout for /bundles (Section 13, Chunk E).
 *
 * The page is a 'use client' component and cannot export
 * metadata itself, so this layout carries it — same pattern as
 * the other metadata wrappers. Brand suffix is "SmartBuy AI".
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Budget-to-Cart Allocator \u2014 SmartBuy AI',
  description:
    'One bundle, one budget \u2014 the best combination across the categories you need, from recorded prices only.',
  alternates: {
    canonical: `${appConfig.url}/bundles`,
  },
  openGraph: {
    title: 'Budget-to-Cart Allocator \u2014 SmartBuy AI',
    description:
      'One bundle, one budget \u2014 the best combination across the categories you need, from recorded prices only.',
    url: `${appConfig.url}/bundles`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Budget-to-Cart Allocator \u2014 SmartBuy AI',
    description:
      'One bundle, one budget \u2014 the best combination across the categories you need, from recorded prices only.',
  },
};

export default function BundlesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
