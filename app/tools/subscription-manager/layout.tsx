/**
 * Per-tool metadata (Section 16, item 13).
 *
 * Subscription manager used to share the generic /tools hub metadata
 * (app/tools/layout.tsx). Title/description come from the
 * page's own heading and intro copy. The metadata lives here
 * — not in page.tsx — because the page is a client component
 * ('use client'), which cannot export metadata.
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Subscription manager — SmartBuy AI',
  description: 'Your consumer subscriptions — streaming, apps, services — in one place, with renewal reminders and flags for duplicates and subscriptions you rarely use.',
  alternates: {
    canonical: `${appConfig.url}/tools/subscription-manager`,
  },
  openGraph: {
    title: 'Subscription manager — SmartBuy AI',
    description: 'Your consumer subscriptions — streaming, apps, services — in one place, with renewal reminders and flags for duplicates and subscriptions you rarely use.',
    url: `${appConfig.url}/tools/subscription-manager`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Subscription manager — SmartBuy AI',
    description: 'Your consumer subscriptions — streaming, apps, services — in one place, with renewal reminders and flags for duplicates and subscriptions you rarely use.',
  },
};

export default function ToolLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // JSX return (same pattern as app/admin/layout.tsx): returning
  // children bare trips TS1062 under `next build` route-type
  // checking — the fragment infers Promise<JSX.Element>.
  return <>{children}</>;
}
