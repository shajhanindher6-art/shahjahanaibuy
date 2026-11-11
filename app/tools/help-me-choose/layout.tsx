/**
 * Metadata layout for /tools/help-me-choose (Section 12).
 *
 * The quiz page is a 'use client' component and cannot export
 * metadata itself, so this layout carries it — same pattern as the
 * other metadata wrappers. Brand suffix is "SmartBuy AI".
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Help Me Choose — SmartBuy AI',
  description:
    'Answer four quick questions and get ranked product picks, each with a short reason why. No account needed, no invented picks.',
  alternates: {
    canonical: `${appConfig.url}/tools/help-me-choose`,
  },
  openGraph: {
    title: 'Help Me Choose — SmartBuy AI',
    description:
      'Answer four quick questions and get ranked product picks, each with a short reason why. No account needed, no invented picks.',
    url: `${appConfig.url}/tools/help-me-choose`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Help Me Choose — SmartBuy AI',
    description:
      'Answer four quick questions and get ranked product picks, each with a short reason why. No account needed, no invented picks.',
  },
};

export default function HelpMeChooseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
