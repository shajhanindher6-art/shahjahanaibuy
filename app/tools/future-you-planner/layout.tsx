/**
 * Metadata layout for /tools/future-you-planner (Section 13, Chunk E).
 *
 * The page is a 'use client' component and cannot export
 * metadata itself, so this layout carries it — same pattern as
 * the other metadata wrappers. Brand suffix is "SmartBuy AI".
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'AI \u201cFuture You\u201d Planner \u2014 SmartBuy AI',
  description:
    'A saving plan for big purchases \u2014 set a target and a date, and get a monthly plan, linked to price-drop alerts.',
  alternates: {
    canonical: `${appConfig.url}/tools/future-you-planner`,
  },
  openGraph: {
    title: 'AI \u201cFuture You\u201d Planner \u2014 SmartBuy AI',
    description:
      'A saving plan for big purchases \u2014 set a target and a date, and get a monthly plan, linked to price-drop alerts.',
    url: `${appConfig.url}/tools/future-you-planner`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'AI \u201cFuture You\u201d Planner \u2014 SmartBuy AI',
    description:
      'A saving plan for big purchases \u2014 set a target and a date, and get a monthly plan, linked to price-drop alerts.',
  },
};

export default function FutureYouPlannerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
