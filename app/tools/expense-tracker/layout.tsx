/**
 * Metadata layout for /tools/expense-tracker (Section 13, Chunk E).
 *
 * The page is a 'use client' component and cannot export
 * metadata itself, so this layout carries it — same pattern as
 * the other metadata wrappers. Brand suffix is "SmartBuy AI".
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'AI Receipt & Expense Tracker \u2014 SmartBuy AI',
  description:
    'See what you spent, by category, each month \u2014 recorded when a purchase is confirmed, with an alert when you go over budget.',
  alternates: {
    canonical: `${appConfig.url}/tools/expense-tracker`,
  },
  openGraph: {
    title: 'AI Receipt & Expense Tracker \u2014 SmartBuy AI',
    description:
      'See what you spent, by category, each month \u2014 recorded when a purchase is confirmed, with an alert when you go over budget.',
    url: `${appConfig.url}/tools/expense-tracker`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'AI Receipt & Expense Tracker \u2014 SmartBuy AI',
    description:
      'See what you spent, by category, each month \u2014 recorded when a purchase is confirmed, with an alert when you go over budget.',
  },
};

export default function ExpenseTrackerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
