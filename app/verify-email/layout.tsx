/**
 * Metadata layout for /verify-email (Section 14, Chunk 6).
 *
 * The page is a 'use client' component and cannot export metadata
 * itself, so this layout carries it. robots noindex: an email-
 * verification form is not content to index.
 */

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Verify email — SmartBuy AI',
  robots: {
    index: false,
    follow: false,
  },
};

export default function VerifyEmailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
