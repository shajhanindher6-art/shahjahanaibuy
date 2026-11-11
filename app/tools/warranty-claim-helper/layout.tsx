/**
 * Metadata layout for /tools/warranty-claim-helper (Section 13, Chunk E).
 *
 * The page is a 'use client' component and cannot export
 * metadata itself, so this layout carries it — same pattern as
 * the other metadata wrappers. Brand suffix is "SmartBuy AI".
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'AI Warranty Claim Helper \u2014 SmartBuy AI',
  description:
    'A step-by-step claim checklist from your Vault \u2014 documents, retailer or brand contact, and a reminder before expiry.',
  alternates: {
    canonical: `${appConfig.url}/tools/warranty-claim-helper`,
  },
  openGraph: {
    title: 'AI Warranty Claim Helper \u2014 SmartBuy AI',
    description:
      'A step-by-step claim checklist from your Vault \u2014 documents, retailer or brand contact, and a reminder before expiry.',
    url: `${appConfig.url}/tools/warranty-claim-helper`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'AI Warranty Claim Helper \u2014 SmartBuy AI',
    description:
      'A step-by-step claim checklist from your Vault \u2014 documents, retailer or brand contact, and a reminder before expiry.',
  },
};

export default function WarrantyClaimHelperLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
