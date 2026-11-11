/**
 * Metadata layout for /tools/subscription-manager (Section 13, Chunk E).
 *
 * The page is a 'use client' component and cannot export
 * metadata itself, so this layout carries it — same pattern as
 * the other metadata wrappers. Brand suffix is "SmartBuy AI".
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'AI Subscription Manager \u2014 SmartBuy AI',
  description:
    'Netflix, Spotify, and every other subscription in one place \u2014 renewal reminders, and a flag for duplicates or rarely used ones.',
  alternates: {
    canonical: `${appConfig.url}/tools/subscription-manager`,
  },
  openGraph: {
    title: 'AI Subscription Manager \u2014 SmartBuy AI',
    description:
      'Netflix, Spotify, and every other subscription in one place \u2014 renewal reminders, and a flag for duplicates or rarely used ones.',
    url: `${appConfig.url}/tools/subscription-manager`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'AI Subscription Manager \u2014 SmartBuy AI',
    description:
      'Netflix, Spotify, and every other subscription in one place \u2014 renewal reminders, and a flag for duplicates or rarely used ones.',
  },
};

export default function SubscriptionManagerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
