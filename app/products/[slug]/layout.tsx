/**
 * Product [slug] layout — the soft-404 fix.
 *
 * WHY THIS FILE EXISTS (proven 2026-11-12 with a minimal Next 13.5.9
 * repro app, same version as this repo): a notFound() thrown by the
 * page — or by generateMetadata — does NOT produce HTTP 404 when a
 * loading.tsx wraps the route. The loading shell streams first with
 * status 200, and the inner NotFoundBoundary swallows the error, so
 * the response stays 200 with only the loading shell (soft 404 —
 * live-verified 2026-11-12: all three [slug] routes returned 200).
 * Removing loading.tsx fixes the status but loses the skeleton.
 *
 * This layout runs BEFORE the loading.tsx Suspense boundary (the
 * boundary wraps the layout's children, not the layout itself), so a
 * notFound() thrown here reaches Next's outer render catch, which
 * sets res.statusCode = 404. The skeleton is untouched: valid
 * products still stream it (proven in the same repro).
 *
 * Cost: one cached product-row lookup. getCachedProductBySlug is
 * SWR-cached (60s fresh / 5min stale), so the layout, the metadata
 * and the page body share one row — no extra database load.
 */
import React from 'react';
import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCachedProductBySlug } from '@/services/products';

export default async function ProductSlugLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { slug: string };
}) {
  const supabase = await createSupabaseServerClient();
  const product = await getCachedProductBySlug(supabase, params.slug);
  if (!product) {
    notFound();
  }
  // JSX return (same pattern as app/admin/layout.tsx): returning
  // children bare as Promise<ReactNode> trips TS1062 in this
  // TypeScript/react-types combination; the fragment infers
  // Promise<JSX.Element> and type-checks clean. The value import
  // of React also keeps the node vitest env happy (classic JSX
  // runtime needs React in scope).
  return <>{children}</>;
}
