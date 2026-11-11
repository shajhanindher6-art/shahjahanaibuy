/**
 * Metadata layout for /sign-up (Section 14, Chunk 6).
 *
 * The page is a 'use client' component and cannot export metadata
 * itself, so this layout carries it — same pattern as the tool
 * metadata wrappers. robots noindex: a sign-up form is not content
 * to index. Brand suffix is "SmartBuy AI".
 */

import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Sign up — SmartBuy AI',
  description:
    'Create a free SmartBuy AI account to track prices, save wishlists, and get price-drop alerts.',
  alternates: {
    canonical: `${appConfig.url}/sign-up`,
  },
  openGraph: {
    title: 'Sign up — SmartBuy AI',
    description:
      'Create a free SmartBuy AI account to track prices, save wishlists, and get price-drop alerts.',
    url: `${appConfig.url}/sign-up`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Sign up — SmartBuy AI',
    description:
      'Create a free SmartBuy AI account to track prices, save wishlists, and get price-drop alerts.',
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function SignUpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
