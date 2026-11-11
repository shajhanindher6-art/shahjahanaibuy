/**
 * Metadata layout for /forgot-password (Section 14, Chunk 6).
 *
 * The page is a 'use client' component and cannot export metadata
 * itself, so this layout carries it. robots noindex: a password-
 * reset form is not content to index.
 */

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Forgot password — SmartBuy AI',
  robots: {
    index: false,
    follow: false,
  },
};

export default function ForgotPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
