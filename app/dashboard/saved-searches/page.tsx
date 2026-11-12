/**
 * Saved searches — dedicated page (Section 17, Stage C item 18).
 *
 * The API already existed (GET/POST/PATCH/DELETE
 * /api/v1/saved-searches) and the list was only surfaced as a
 * section inside /dashboard and a save form on /search. This page
 * is the dedicated home for the feature: the full list with
 * re-run links, match-notification toggles and delete, all via
 * the existing <SavedSearches /> component (no new write path —
 * saving a NEW search still happens from /search, where there is
 * a current search to save).
 *
 * Auth: the dashboard layout (app/dashboard/layout.tsx) is a
 * server-side gate — no session → /sign-in before anything
 * renders. The page itself adds no second gate and no data
 * fetch: the component reads the API client-side, so a guest
 * can never see another user's searches (the API scopes every
 * query to the caller and RLS enforces it). Robots: the
 * dashboard layout already sets index: false / follow: false,
 * and robots.txt disallows /dashboard/ — this page is not
 * indexed and is NOT in the sitemap (same as every other
 * /dashboard page).
 *
 * Honest empty states come from the component: no saved
 * searches → "No saved searches yet"; migration 039 unapplied
 * → "Saved searches are not available yet" (the API 503s);
 * guest → sign-in note. Nothing here invents a saved search.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { SavedSearches } from '@/components/search/saved-searches';

export const metadata: Metadata = {
  title: 'Saved searches | SmartBuy',
  description:
    'Your saved searches — re-run them, get notified when a new product matches, or delete them.',
};

export default function SavedSearchesPage() {
  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to dashboard
      </Link>
      <h1 className="mt-4 text-2xl font-bold">Saved searches</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Re-run a search, turn on match notifications to hear when a
        new product matches it, or delete it. To save a new search,
        run it on the{' '}
        <Link href="/search" className="underline hover:text-foreground">
          search page
        </Link>{' '}
        and use “Save search” there.
      </p>
      <div className="mt-6">
        <SavedSearches />
      </div>
    </div>
  );
}
