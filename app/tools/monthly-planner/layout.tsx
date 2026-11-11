/**
 * Metadata layout for /tools/monthly-planner (Section 13, Chunk E).
 *
 * The page is a 'use client' component and cannot export
 * metadata itself, so this layout carries it — same pattern as
 * the other metadata wrappers. Brand suffix is "SmartBuy AI".
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'AI Monthly Shopping Planner \u2014 SmartBuy AI',
  description:
    'Set a monthly budget and get a plan: what to buy now, what to wait on, and what to push to next month.',
  alternates: {
    canonical: `${appConfig.url}/tools/monthly-planner`,
  },
  openGraph: {
    title: 'AI Monthly Shopping Planner \u2014 SmartBuy AI',
    description:
      'Set a monthly budget and get a plan: what to buy now, what to wait on, and what to push to next month.',
    url: `${appConfig.url}/tools/monthly-planner`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'AI Monthly Shopping Planner \u2014 SmartBuy AI',
    description:
      'Set a monthly budget and get a plan: what to buy now, what to wait on, and what to push to next month.',
  },
};

export default function MonthlyPlannerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
