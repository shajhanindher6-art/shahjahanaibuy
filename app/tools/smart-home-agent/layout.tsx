/**
 * Metadata layout for /tools/smart-home-agent (Section 13, Chunk E).
 *
 * The page is a 'use client' component and cannot export
 * metadata itself, so this layout carries it — same pattern as
 * the other metadata wrappers. Brand suffix is "SmartBuy AI".
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'AI Smart Home Reorder Agent \u2014 SmartBuy AI',
  description:
    'Your home reorders itself: device triggers plus your reorder rules, with confirmation before every order.',
  alternates: {
    canonical: `${appConfig.url}/tools/smart-home-agent`,
  },
  openGraph: {
    title: 'AI Smart Home Reorder Agent \u2014 SmartBuy AI',
    description:
      'Your home reorders itself: device triggers plus your reorder rules, with confirmation before every order.',
    url: `${appConfig.url}/tools/smart-home-agent`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'AI Smart Home Reorder Agent \u2014 SmartBuy AI',
    description:
      'Your home reorders itself: device triggers plus your reorder rules, with confirmation before every order.',
  },
};

export default function SmartHomeAgentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
