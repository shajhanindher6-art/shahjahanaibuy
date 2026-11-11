/**
 * Metadata layout for /tools/price-drop-digest (Section 13, Chunk E).
 *
 * The page is a 'use client' component and cannot export
 * metadata itself, so this layout carries it — same pattern as
 * the other metadata wrappers. Brand suffix is "SmartBuy AI".
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'AI Price-Drop Digest \u2014 SmartBuy AI',
  description:
    'One daily or weekly summary of your watched products \u2014 top deals first, each with one line saying why it is good.',
  alternates: {
    canonical: `${appConfig.url}/tools/price-drop-digest`,
  },
  openGraph: {
    title: 'AI Price-Drop Digest \u2014 SmartBuy AI',
    description:
      'One daily or weekly summary of your watched products \u2014 top deals first, each with one line saying why it is good.',
    url: `${appConfig.url}/tools/price-drop-digest`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'AI Price-Drop Digest \u2014 SmartBuy AI',
    description:
      'One daily or weekly summary of your watched products \u2014 top deals first, each with one line saying why it is good.',
  },
};

export default function PriceDropDigestLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
