/**
 * Metadata layout for /tools/trade-in-finder (Section 13, Chunk E).
 *
 * The page is a 'use client' component and cannot export
 * metadata itself, so this layout carries it — same pattern as
 * the other metadata wrappers. Brand suffix is "SmartBuy AI".
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'AI Trade-in & Second-hand Finder \u2014 SmartBuy AI',
  description:
    'Sell the old one before buying new: real trade-in programs and certified refurbished listings, linked to your resale value.',
  alternates: {
    canonical: `${appConfig.url}/tools/trade-in-finder`,
  },
  openGraph: {
    title: 'AI Trade-in & Second-hand Finder \u2014 SmartBuy AI',
    description:
      'Sell the old one before buying new: real trade-in programs and certified refurbished listings, linked to your resale value.',
    url: `${appConfig.url}/tools/trade-in-finder`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'AI Trade-in & Second-hand Finder \u2014 SmartBuy AI',
    description:
      'Sell the old one before buying new: real trade-in programs and certified refurbished listings, linked to your resale value.',
  },
};

export default function TradeInFinderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
