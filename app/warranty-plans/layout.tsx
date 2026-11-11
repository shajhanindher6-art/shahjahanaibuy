/**
 * Metadata layout for /warranty-plans (Section 13, Chunk E).
 *
 * The page is a 'use client' component and cannot export
 * metadata itself, so this layout carries it — same pattern as
 * the other metadata wrappers. Brand suffix is "SmartBuy AI".
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Warranty & insurance plans \u2014 SmartBuy AI',
  description:
    'Third-party warranty and insurance plans recorded by an admin from each provider\u2019s own published page. Plans are listed, never recommended.',
  alternates: {
    canonical: `${appConfig.url}/warranty-plans`,
  },
  openGraph: {
    title: 'Warranty & insurance plans \u2014 SmartBuy AI',
    description:
      'Third-party warranty and insurance plans recorded by an admin from each provider\u2019s own published page. Plans are listed, never recommended.',
    url: `${appConfig.url}/warranty-plans`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Warranty & insurance plans \u2014 SmartBuy AI',
    description:
      'Third-party warranty and insurance plans recorded by an admin from each provider\u2019s own published page. Plans are listed, never recommended.',
  },
};

export default function WarrantyPlansLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
