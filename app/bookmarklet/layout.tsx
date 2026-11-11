/**
 * Metadata layout for /bookmarklet (Section 13, Chunk E).
 *
 * The page is a 'use client' component and cannot export
 * metadata itself, so this layout carries it — same pattern as
 * the other metadata wrappers. Brand suffix is "SmartBuy AI".
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Track from any store \u2014 SmartBuy AI',
  description:
    'No extension install needed. Add the SmartBuy bookmarklet once, then track products from Amazon, Walmart, Best Buy, eBay, or any other shopping site.',
  alternates: {
    canonical: `${appConfig.url}/bookmarklet`,
  },
  openGraph: {
    title: 'Track from any store \u2014 SmartBuy AI',
    description:
      'No extension install needed. Add the SmartBuy bookmarklet once, then track products from Amazon, Walmart, Best Buy, eBay, or any other shopping site.',
    url: `${appConfig.url}/bookmarklet`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Track from any store \u2014 SmartBuy AI',
    description:
      'No extension install needed. Add the SmartBuy bookmarklet once, then track products from Amazon, Walmart, Best Buy, eBay, or any other shopping site.',
  },
};

export default function BookmarkletLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
