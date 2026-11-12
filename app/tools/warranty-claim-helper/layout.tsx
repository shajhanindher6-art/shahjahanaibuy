/**
 * Per-tool metadata (Section 16, item 13).
 *
 * AI Warranty Claim Helper used to share the generic /tools hub metadata
 * (app/tools/layout.tsx). Title/description come from the
 * page's own heading and intro copy. The metadata lives here
 * — not in page.tsx — because the page is a client component
 * ('use client'), which cannot export metadata.
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'AI Warranty Claim Helper — SmartBuy AI',
  description: 'Your Receipt Vault items, each with a claim checklist — the documents to gather, the retailer or brand contact, and the steps — plus a reminder before the warranty expires.',
  alternates: {
    canonical: `${appConfig.url}/tools/warranty-claim-helper`,
  },
  openGraph: {
    title: 'AI Warranty Claim Helper — SmartBuy AI',
    description: 'Your Receipt Vault items, each with a claim checklist — the documents to gather, the retailer or brand contact, and the steps — plus a reminder before the warranty expires.',
    url: `${appConfig.url}/tools/warranty-claim-helper`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'AI Warranty Claim Helper — SmartBuy AI',
    description: 'Your Receipt Vault items, each with a claim checklist — the documents to gather, the retailer or brand contact, and the steps — plus a reminder before the warranty expires.',
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
