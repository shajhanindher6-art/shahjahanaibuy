/**
 * Per-tool metadata (Section 16, item 13).
 *
 * Expense tracker used to share the generic /tools hub metadata
 * (app/tools/layout.tsx). Title/description come from the
 * page's own heading and intro copy. The metadata lives here
 * — not in page.tsx — because the page is a client component
 * ('use client'), which cannot export metadata.
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Expense tracker — SmartBuy AI',
  description: 'Monthly spend by category, from expenses you record yourself. The amount is always entered by you or taken from a recorded price — never guessed.',
  alternates: {
    canonical: `${appConfig.url}/tools/expense-tracker`,
  },
  openGraph: {
    title: 'Expense tracker — SmartBuy AI',
    description: 'Monthly spend by category, from expenses you record yourself. The amount is always entered by you or taken from a recorded price — never guessed.',
    url: `${appConfig.url}/tools/expense-tracker`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Expense tracker — SmartBuy AI',
    description: 'Monthly spend by category, from expenses you record yourself. The amount is always entered by you or taken from a recorded price — never guessed.',
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
