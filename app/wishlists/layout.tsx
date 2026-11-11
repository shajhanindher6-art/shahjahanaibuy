/**
 * Metadata layout for /wishlists/[id] (Section 14, Chunk 6).
 *
 * The shared-wishlist page is a 'use client' component and cannot
 * export metadata itself, so this layout carries it. robots
 * noindex: a shared wishlist is a private link, not content to
 * index. No canonical: the per-list URL cannot be known here, and
 * inventing one for a dynamic id would be wrong.
 */

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Shared wishlist — SmartBuy AI',
  robots: {
    index: false,
    follow: false,
  },
};

export default function WishlistsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
