/**
 * Metadata layout for /tools/product-qa (Section 13, Chunk E).
 *
 * The page is a 'use client' component and cannot export
 * metadata itself, so this layout carries it — same pattern as
 * the other metadata wrappers. Brand suffix is "SmartBuy AI".
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'AI Product Q&A Assistant \u2014 SmartBuy AI',
  description:
    'Ask a question, get an answer from recorded specs, reviews, and sentiment \u2014 always labelled \u201cAI answer\u201d, with its source.',
  alternates: {
    canonical: `${appConfig.url}/tools/product-qa`,
  },
  openGraph: {
    title: 'AI Product Q&A Assistant \u2014 SmartBuy AI',
    description:
      'Ask a question, get an answer from recorded specs, reviews, and sentiment \u2014 always labelled \u201cAI answer\u201d, with its source.',
    url: `${appConfig.url}/tools/product-qa`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'AI Product Q&A Assistant \u2014 SmartBuy AI',
    description:
      'Ask a question, get an answer from recorded specs, reviews, and sentiment \u2014 always labelled \u201cAI answer\u201d, with its source.',
  },
};

export default function ProductQaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
