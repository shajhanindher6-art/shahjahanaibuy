/**
 * Metadata layout for /tools/list-optimizer (Section 13, Chunk E).
 *
 * The page is a 'use client' component and cannot export
 * metadata itself, so this layout carries it — same pattern as
 * the other metadata wrappers. Brand suffix is "SmartBuy AI".
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'AI Shopping List Optimizer \u2014 SmartBuy AI',
  description:
    'Your whole list, cheapest way: which item to buy from which store, with the total and the saving \u2014 recorded prices only.',
  alternates: {
    canonical: `${appConfig.url}/tools/list-optimizer`,
  },
  openGraph: {
    title: 'AI Shopping List Optimizer \u2014 SmartBuy AI',
    description:
      'Your whole list, cheapest way: which item to buy from which store, with the total and the saving \u2014 recorded prices only.',
    url: `${appConfig.url}/tools/list-optimizer`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'AI Shopping List Optimizer \u2014 SmartBuy AI',
    description:
      'Your whole list, cheapest way: which item to buy from which store, with the total and the saving \u2014 recorded prices only.',
  },
};

export default function ListOptimizerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
