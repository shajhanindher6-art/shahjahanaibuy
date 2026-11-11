/**
 * Metadata layout for /tools/savings-dashboard (Section 13, Chunk E).
 *
 * The page is a 'use client' component and cannot export
 * metadata itself, so this layout carries it — same pattern as
 * the other metadata wrappers. Brand suffix is "SmartBuy AI".
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'AI Savings Dashboard \u2014 SmartBuy AI',
  description:
    '\u201cHow much have you saved so far\u201d \u2014 total saved, this month, and your biggest saving, from confirmed recorded savings only.',
  alternates: {
    canonical: `${appConfig.url}/tools/savings-dashboard`,
  },
  openGraph: {
    title: 'AI Savings Dashboard \u2014 SmartBuy AI',
    description:
      '\u201cHow much have you saved so far\u201d \u2014 total saved, this month, and your biggest saving, from confirmed recorded savings only.',
    url: `${appConfig.url}/tools/savings-dashboard`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'AI Savings Dashboard \u2014 SmartBuy AI',
    description:
      '\u201cHow much have you saved so far\u201d \u2014 total saved, this month, and your biggest saving, from confirmed recorded savings only.',
  },
};

export default function SavingsDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
