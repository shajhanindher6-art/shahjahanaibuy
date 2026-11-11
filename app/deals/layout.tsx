/**
 * Metadata layout for /deals (Section 13, Chunk E).
 *
 * The page is a 'use client' component and cannot export
 * metadata itself, so this layout carries it — same pattern as
 * the other metadata wrappers. Brand suffix is "SmartBuy AI".
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Smart Deal Finder \u2014 SmartBuy AI',
  description:
    'AI-ranked deals, flash sales, coupons, and hidden discounts \u2014 from recorded deals only, never invented prices.',
  alternates: {
    canonical: `${appConfig.url}/deals`,
  },
  openGraph: {
    title: 'Smart Deal Finder \u2014 SmartBuy AI',
    description:
      'AI-ranked deals, flash sales, coupons, and hidden discounts \u2014 from recorded deals only, never invented prices.',
    url: `${appConfig.url}/deals`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Smart Deal Finder \u2014 SmartBuy AI',
    description:
      'AI-ranked deals, flash sales, coupons, and hidden discounts \u2014 from recorded deals only, never invented prices.',
  },
};

export default function DealsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
