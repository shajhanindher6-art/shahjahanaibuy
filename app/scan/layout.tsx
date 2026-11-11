/**
 * Metadata layout for /scan (Section 13, Chunk E).
 *
 * The page is a 'use client' component and cannot export
 * metadata itself, so this layout carries it — same pattern as
 * the other metadata wrappers. Brand suffix is "SmartBuy AI".
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Scan a Product \u2014 SmartBuy AI',
  description:
    'Take or upload a photo, confirm what it shows, and find it in SmartBuy\u2019s catalog with real store prices. Your photo never leaves this browser.',
  alternates: {
    canonical: `${appConfig.url}/scan`,
  },
  openGraph: {
    title: 'Scan a Product \u2014 SmartBuy AI',
    description:
      'Take or upload a photo, confirm what it shows, and find it in SmartBuy\u2019s catalog with real store prices. Your photo never leaves this browser.',
    url: `${appConfig.url}/scan`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Scan a Product \u2014 SmartBuy AI',
    description:
      'Take or upload a photo, confirm what it shows, and find it in SmartBuy\u2019s catalog with real store prices. Your photo never leaves this browser.',
  },
};

export default function ScanLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
