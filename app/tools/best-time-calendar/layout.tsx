/**
 * Metadata layout for /tools/best-time-calendar (Section 13, Chunk E).
 *
 * The page is a 'use client' component and cannot export
 * metadata itself, so this layout carries it — same pattern as
 * the other metadata wrappers. Brand suffix is "SmartBuy AI".
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'AI Best-Time-to-Buy Calendar \u2014 SmartBuy AI',
  description:
    'The best time of year to buy, per category, from recorded price history \u2014 ranges only, never a promised exact date.',
  alternates: {
    canonical: `${appConfig.url}/tools/best-time-calendar`,
  },
  openGraph: {
    title: 'AI Best-Time-to-Buy Calendar \u2014 SmartBuy AI',
    description:
      'The best time of year to buy, per category, from recorded price history \u2014 ranges only, never a promised exact date.',
    url: `${appConfig.url}/tools/best-time-calendar`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'AI Best-Time-to-Buy Calendar \u2014 SmartBuy AI',
    description:
      'The best time of year to buy, per category, from recorded price history \u2014 ranges only, never a promised exact date.',
  },
};

export default function BestTimeCalendarLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
