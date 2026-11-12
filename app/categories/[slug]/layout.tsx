/**
 * Category [slug] layout — the soft-404 fix (same mechanism as
 * app/products/[slug]/layout.tsx — see the comment there).
 *
 * A notFound() thrown by the page or generateMetadata is swallowed
 * by the loading.tsx Suspense boundary and the response keeps status
 * 200 (live-verified 2026-11-12). This layout checks the slug
 * BEFORE that boundary, so an unknown category reaches Next's outer
 * render catch and returns a real HTTP 404. The categories loading
 * skeleton is untouched.
 *
 * Cost: none extra. getCategoryPageData is React-cache() memoized
 * per request (lib/brand-category-seo-server.ts), so the layout, the
 * metadata and the page body share one execution.
 */
import React from 'react';
import { notFound } from 'next/navigation';
import { getCategoryPageData } from '@/lib/brand-category-seo-server';

export default async function CategorySlugLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { slug: string };
}) {
  const page = await getCategoryPageData(params.slug);
  if (!page) {
    notFound();
  }
  // JSX return (same pattern as app/admin/layout.tsx and the
  // products slug layout): returning children bare as
  // Promise<ReactNode> trips TS1062 — plain tsc passed this file
  // but `next build` type-checks it against the generated route
  // types and fails. The fragment infers Promise<JSX.Element>.
  // The value import of React also keeps the node vitest env happy.
  return <>{children}</>;
}
