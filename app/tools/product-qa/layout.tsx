/**
 * Per-tool metadata (Section 16, item 13).
 *
 * AI Product Q&A used to share the generic /tools hub metadata
 * (app/tools/layout.tsx). Title/description come from the
 * page's own heading and intro copy. The metadata lives here
 * — not in page.tsx — because the page is a client component
 * ('use client'), which cannot export metadata.
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'AI Product Q&A — SmartBuy AI',
  description: 'Ask a question about a product — the answer comes from its recorded specs and reviews only. No LLM, nothing guessed.',
  alternates: {
    canonical: `${appConfig.url}/tools/product-qa`,
  },
  openGraph: {
    title: 'AI Product Q&A — SmartBuy AI',
    description: 'Ask a question about a product — the answer comes from its recorded specs and reviews only. No LLM, nothing guessed.',
    url: `${appConfig.url}/tools/product-qa`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'AI Product Q&A — SmartBuy AI',
    description: 'Ask a question about a product — the answer comes from its recorded specs and reviews only. No LLM, nothing guessed.',
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
