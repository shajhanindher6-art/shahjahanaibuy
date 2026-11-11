/**
 * Metadata layout for /sign-in (Section 14, Chunk 6).
 *
 * The page is a 'use client' component and cannot export metadata
 * itself, so this layout carries it — same pattern as the tool
 * metadata wrappers. robots noindex: a sign-in form is not content
 * to index. Brand suffix is "SmartBuy AI".
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Sign in — SmartBuy AI',
  description:
    'Sign in to SmartBuy AI to track prices, save wishlists, and get price-drop alerts.',
  alternates: {
    canonical: `${appConfig.url}/sign-in`,
  },
  openGraph: {
    title: 'Sign in — SmartBuy AI',
    description:
      'Sign in to SmartBuy AI to track prices, save wishlists, and get price-drop alerts.',
    url: `${appConfig.url}/sign-in`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Sign in — SmartBuy AI',
    description:
      'Sign in to SmartBuy AI to track prices, save wishlists, and get price-drop alerts.',
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function SignInLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
