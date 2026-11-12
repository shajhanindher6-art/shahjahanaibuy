/**
 * Store Finder — /tools/store-finder (Section 11, Chunk D).
 *
 * Country-first reverse lookup over the existing store directory
 * (lib/stores.ts) and region registry (lib/region.ts). CLIENT page,
 * NO API route, NO database.
 *
 * How the default country is picked (same precedence as the
 * RegionProvider, but read locally so this page never depends on
 * provider context): saved `sb-country` choice (localStorage,
 * then cookie) first, then the browser timezone / language guess
 * (lib/region.ts guessCountryFromBrowser), then US.
 *
 * HONESTY — read before widening this page:
 * - This is a DIRECTORY + SEARCH LINKS lookup, not a price feed.
 *   Clicking a store takes the shopper to that store's OWN search
 *   results for the product name. No price, stock, deal, rating,
 *   or partnership is claimed for any store.
 * - It NEVER claims a store "ships to your country": no shipping
 *   data exists anywhere in this project. The framing is exactly
 *   "stores in your country — search this product on their site".
 * - There is NO category filter: stores carry no category data,
 *   and inventing one would be fake.
 * - Countries with no confirmed local store (South Africa today)
 *   honestly show the worldwide retailer fallback, labelled as
 *   such — never US stores passed off as local.
 */

'use client';

import { useRegion } from '@/components/region/region-provider';
import { tFor } from '@/lib/i18n';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Store } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { REGIONS, guessCountryFromBrowser } from '@/lib/region';
import {
  buildStoreSearchUrl,
  getStoresSplit,
  type LocalStore,
} from '@/lib/stores';

const COUNTRY_STORAGE_KEY = 'sb-country';

function readSavedCountry(): string | null {
  try {
    const stored = localStorage.getItem(COUNTRY_STORAGE_KEY);
    if (stored) return stored.toUpperCase();
  } catch {
    // Storage unavailable — fall through to the cookie.
  }
  try {
    const match = document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COUNTRY_STORAGE_KEY}=`));
    if (match) {
      return decodeURIComponent(
        match.slice(COUNTRY_STORAGE_KEY.length + 1)
      ).toUpperCase();
    }
  } catch {
    // Cookie unreadable — fall through to the browser guess.
  }
  return null;
}

export default function StoreFinderPage() {
  const { language } = useRegion();
  const [countryCode, setCountryCode] = useState('US');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const saved = readSavedCountry();
    if (saved) {
      setCountryCode(saved);
      return;
    }
    setCountryCode(guessCountryFromBrowser() ?? 'US');
  }, []);

  const region = useMemo(
    () => REGIONS.find((r) => r.code === countryCode) ?? null,
    [countryCode]
  );
  const { local, international, hasLocal } = useMemo(
    () => getStoresSplit(countryCode),
    [countryCode]
  );
  const trimmedQuery = query.trim();

  const renderStore = (store: LocalStore) => {
    const searchUrl = trimmedQuery
      ? buildStoreSearchUrl(store, trimmedQuery)
      : null;
    return (
      <li
        key={`${store.countryCode}-${store.slug}`}
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
      >
        <div>
          <p className="font-medium">{store.name}</p>
          <p className="text-sm text-muted-foreground">{store.websiteUrl}</p>
        </div>
        {searchUrl ? (
          <a
            href={searchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Search &ldquo;{trimmedQuery}&rdquo; on {store.name} →
          </a>
        ) : (
          <a
            href={store.websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center rounded-md border px-4 py-2 text-sm font-medium"
          >
            Visit {store.name} →
          </a>
        )}
      </li>
    );
  };

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Store className="h-7 w-7 text-blue-600" /> {tFor(language, 'toolHeadingStoreFinder')}
          </h1>
          <p className="mt-2 text-muted-foreground">
            Find the stores in your country, then search a product on
            their own site. These are search links only — SmartBuy
            does not show their prices or stock, and listing a store
            here does not mean it ships to your country: we have no
            shipping data, so check delivery on the store&apos;s site.
          </p>

          <div className="mt-8 space-y-4">
            <div>
              <label
                htmlFor="store-finder-country"
                className="text-sm font-medium"
              >
                Your country
              </label>
              <select
                id="store-finder-country"
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
                className="mt-1 block w-full min-h-[44px] rounded-md border bg-background px-3 py-2 text-sm"
              >
                {[...REGIONS]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.name}
                    </option>
                  ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                Pre-filled from your saved country choice, or from
                your browser&apos;s timezone and language when no
                choice is saved. Change it any time — nothing here is
                saved.
              </p>
            </div>

            <div>
              <label
                htmlFor="store-finder-query"
                className="text-sm font-medium"
              >
                Product to search for (optional)
              </label>
              <input
                id="store-finder-query"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. MacBook Air 13"
                className="mt-1 block w-full min-h-[44px] rounded-md border bg-background px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Type a product name and each store link opens that
                store&apos;s own search results for it. Leave it empty
                to open a store&apos;s homepage instead.
              </p>
            </div>
          </div>

          <h2 className="mt-10 text-xl font-semibold">
            Stores in {region ? region.name : countryCode}
          </h2>
          {hasLocal ? (
            <>
              <p className="mt-2 text-sm text-muted-foreground">
                {local.length} store{local.length === 1 ? '' : 's'} in
                your country — search this product on their site.
              </p>
              <ul className="mt-4 space-y-3">{local.map(renderStore)}</ul>
            </>
          ) : (
            <p className="mt-2 rounded-lg border p-4 text-sm text-muted-foreground">
              No confirmed local store for{' '}
              {region ? region.name : countryCode} yet — the worldwide
              retailers below are shown instead. Stores are only
              listed once their search link is verified, never guessed.
            </p>
          )}

          <h2 className="mt-10 text-xl font-semibold">
            Worldwide retailers
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Search links only — the same honest note as above: no
            prices, no stock, and no shipping claim.
          </p>
          <ul className="mt-4 space-y-3">
            {international.map(renderStore)}
          </ul>

          <p className="mt-8 text-sm text-muted-foreground">
            Looking for live prices instead? Start on the{' '}
            <Link href="/" className="underline">
              home page
            </Link>{' '}
            or browse by{' '}
            <Link href="/brands/apple" className="underline">
              brand
            </Link>{' '}
            and{' '}
            <Link href="/categories/laptops" className="underline">
              category
            </Link>
            .
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
