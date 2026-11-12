/**
 * Per-tool metadata (Section 16, item 13).
 *
 * Help me choose used to share the generic /tools hub metadata
 * (app/tools/layout.tsx). Title/description come from the
 * page's own heading and intro copy. The metadata lives here
 * — not in page.tsx — because the page is a client component
 * ('use client'), which cannot export metadata.
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Help me choose — SmartBuy AI',
  description: 'Answer four quick questions and get ranked picks from real priced products — with one line each saying why it fits. No account, no waiting.',
  alternates: {
    canonical: `${appConfig.url}/tools/help-me-choose`,
  },
  openGraph: {
    title: 'Help me choose — SmartBuy AI',
    description: 'Answer four quick questions and get ranked picks from real priced products — with one line each saying why it fits. No account, no waiting.',
    url: `${appConfig.url}/tools/help-me-choose`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Help me choose — SmartBuy AI',
    description: 'Answer four quick questions and get ranked picks from real priced products — with one line each saying why it fits. No account, no waiting.',
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
