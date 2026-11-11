/**
 * Metadata layout for /blog (Section 13, Chunk E).
 *
 * The page is a 'use client' component and cannot export
 * metadata itself, so this layout carries it — same pattern as
 * the other metadata wrappers. Brand suffix is "SmartBuy AI".
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Blog \u2014 SmartBuy AI',
  description:
    'Shopping guides, deal explainers, and product updates \u2014 written from SmartBuy\u2019s real features and data.',
  alternates: {
    canonical: `${appConfig.url}/blog`,
  },
  openGraph: {
    title: 'Blog \u2014 SmartBuy AI',
    description:
      'Shopping guides, deal explainers, and product updates \u2014 written from SmartBuy\u2019s real features and data.',
    url: `${appConfig.url}/blog`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Blog \u2014 SmartBuy AI',
    description:
      'Shopping guides, deal explainers, and product updates \u2014 written from SmartBuy\u2019s real features and data.',
  },
};

export default function BlogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
