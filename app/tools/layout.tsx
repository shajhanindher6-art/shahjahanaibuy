/**
 * Metadata layout for /tools (Section 13, Chunk E).
 *
 * The hub page is a server component, but its metadata lives
 * here so app/tools/page.tsx stays untouched (another chunk
 * edits that file this wave). Brand suffix is "SmartBuy AI".
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'AI tools \u2014 SmartBuy AI',
  description:
    'The AI tools that make SmartBuy useful every day \u2014 AI that builds your list, counts your spending, manages your subscriptions, answers your questions, and shows your savings.',
  alternates: {
    canonical: `${appConfig.url}/tools`,
  },
  openGraph: {
    title: 'AI tools \u2014 SmartBuy AI',
    description:
      'The AI tools that make SmartBuy useful every day \u2014 AI that builds your list, counts your spending, manages your subscriptions, answers your questions, and shows your savings.',
    url: `${appConfig.url}/tools`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'AI tools \u2014 SmartBuy AI',
    description:
      'The AI tools that make SmartBuy useful every day \u2014 AI that builds your list, counts your spending, manages your subscriptions, answers your questions, and shows your savings.',
  },
};

export default function ToolsHubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
