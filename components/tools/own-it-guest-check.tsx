/**
 * Already-Own-It Guard — guest-lists leaf (T4).
 *
 * Client component: the guest buy list (lib/guest-buy-list.ts)
 * and guest wishlist (lib/guest-wishlist.ts) live in localStorage
 * on THIS device only, so no server component can ever read them.
 * This leaf runs in the browser, reads both device lists, and
 * runs the same lib/own-it-check.ts matching the server page
 * runs over the signed-in lists. It renders nothing until it has
 * mounted (localStorage does not exist during SSR, so rendering
 * before mount would hydrate differently).
 *
 * HONESTY: the heading says "lists on this device" — these are
 * the guest lists, not the account lists, and a non-match here
 * reads "No duplicate found in your lists on this device", never
 * "you don't own this".
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  GUEST_BUY_LIST_EVENT,
  getGuestBuyList,
} from '@/lib/guest-buy-list';
import {
  GUEST_WISHLIST_EVENT,
  getGuestWishlist,
} from '@/lib/guest-wishlist';
import {
  findOwnItMatches,
  type OwnItCandidate,
  type OwnItMatch,
  type OwnItQuery,
} from '@/lib/own-it-check';

function matchedByLabel(match: OwnItMatch): string {
  switch (match.matchedBy) {
    case 'slug':
      return 'Same product (slug match)';
    case 'gtin':
      return 'Same GTIN';
    case 'name-brand-exact':
      return 'Same name and brand';
    case 'name-exact':
      return 'Same name';
    case 'name-brand-fuzzy':
      return 'Similar name and brand — review it, this is not a confirmed duplicate';
  }
}

export function OwnItGuestCheck({ query }: { query: OwnItQuery }) {
  const [mounted, setMounted] = useState(false);
  const [matches, setMatches] = useState<OwnItMatch[] | null>(null);
  const [checkedCount, setCheckedCount] = useState(0);

  useEffect(() => {
    setMounted(true);
    function check() {
      const candidates: OwnItCandidate[] = [
        ...getGuestBuyList().map((item) => ({
          id: item.id,
          source: 'guest-buy-list' as const,
          listLabel: 'Buy list (this device)',
          slug: item.slug,
          name: item.name,
          brand: null,
          gtin: null,
        })),
        ...getGuestWishlist().map((item) => ({
          id: item.id,
          source: 'guest-wishlist' as const,
          listLabel: 'Wishlist (this device)',
          slug: item.slug,
          name: item.name,
          brand: null,
          gtin: null,
        })),
      ];
      setCheckedCount(candidates.length);
      setMatches(findOwnItMatches(query, candidates));
    }
    check();
    window.addEventListener(GUEST_BUY_LIST_EVENT, check);
    window.addEventListener(GUEST_WISHLIST_EVENT, check);
    return () => {
      window.removeEventListener(GUEST_BUY_LIST_EVENT, check);
      window.removeEventListener(GUEST_WISHLIST_EVENT, check);
    };
    // The query is a stable prop object from the server page for
    // one check; re-run when its identifying fields change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.slug, query.name, query.brand, query.gtin]);

  if (!mounted || matches === null) return null;

  return (
    <section className="mt-6 rounded-lg border p-6" aria-live="polite">
      <h2 className="text-lg font-semibold">Lists on this device</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Your guest buy list and guest wishlist, saved in this
        browser only — nothing here was sent to the server.
        {checkedCount === 0
          ? ' There is nothing saved on this device yet.'
          : ` Checked ${checkedCount} saved ${checkedCount === 1 ? 'item' : 'items'}.`}
      </p>
      {matches.length === 0 ? (
        <p className="mt-3 text-sm font-medium">
          No duplicate found in your lists on this device.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {matches.map((match) => (
            <li key={`${match.candidate.source}-${match.candidate.id}`} className="rounded-md bg-muted p-3 text-sm">
              <p className="font-medium">{match.candidate.name}</p>
              <p className="mt-1 text-muted-foreground">
                {match.candidate.listLabel} · {matchedByLabel(match)}
                {!match.exact && ' (similar — check it yourself before deciding)'}
              </p>
              {match.candidate.slug && (
                <Link
                  href={`/products/${match.candidate.slug}`}
                  className="mt-1 inline-block underline underline-offset-4"
                >
                  View product →
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        This checks saved lists only — it cannot tell you whether
        you already own the product.
      </p>
    </section>
  );
}
