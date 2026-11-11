/**
 * Metadata layout for /tools/eco-coach (Section 13, Chunk E).
 *
 * The page is a 'use client' component and cannot export
 * metadata itself, so this layout carries it — same pattern as
 * the other metadata wrappers. Brand suffix is "SmartBuy AI".
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'AI Eco Shopping Coach \u2014 SmartBuy AI',
  description:
    'A monthly carbon budget, with coach advice on each purchase \u2014 recorded carbon first, estimates always labelled as estimates.',
  alternates: {
    canonical: `${appConfig.url}/tools/eco-coach`,
  },
  openGraph: {
    title: 'AI Eco Shopping Coach \u2014 SmartBuy AI',
    description:
      'A monthly carbon budget, with coach advice on each purchase \u2014 recorded carbon first, estimates always labelled as estimates.',
    url: `${appConfig.url}/tools/eco-coach`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'AI Eco Shopping Coach \u2014 SmartBuy AI',
    description:
      'A monthly carbon budget, with coach advice on each purchase \u2014 recorded carbon first, estimates always labelled as estimates.',
  },
};

export default function EcoCoachLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
