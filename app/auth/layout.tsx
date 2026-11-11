/**
 * Metadata layout for /auth/* (Section 14, Chunk 6).
 *
 * The callback page is a 'use client' component and cannot export
 * metadata itself, so this layout carries it. robots noindex: an
 * auth callback handler is not content to index.
 */

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'SmartBuy AI',
  robots: {
    index: false,
    follow: false,
  },
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
