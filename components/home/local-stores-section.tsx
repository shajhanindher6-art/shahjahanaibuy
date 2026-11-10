/**
 * Homepage Local Stores section — geo-targeted store directory.
 *
 * Section 8: the visitor ALWAYS sees both buckets, local first:
 *   1. Local stores in their country (confirmed directory entries
 *      only; an honest note when the country has none).
 *   2. International retailers (worldwide fallback, minus any
 *      store already shown as local).
 * The country comes from IP detection (Vercel geo header, via the
 * RegionProvider) or the visitor's own saved Country Switcher
 * choice — the saved choice always wins.
 *
 * DIRECTORY + LINKS ONLY: these are links to the stores' own
 * homepages. SmartBuy shows no prices, stock, deals, or coupons
 * for these stores and claims no partnership or affiliate
 * relationship. There is no product on the homepage to search for,
 * so links go to the store homepage — not to a product search.
 */

'use client';

import Link from 'next/link';
import { Store } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useRegion } from '@/components/region/region-provider';
import { getRegionByCountry } from '@/lib/region';
import { getStoresSplit, type LocalStore } from '@/lib/stores';

function StoreCard({ store }: { store: LocalStore }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{store.name}</CardTitle>
        <CardDescription>
          {new URL(store.websiteUrl).hostname}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <a href={store.websiteUrl} target="_blank" rel="noopener noreferrer">
            Visit {store.name}
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}

export function LocalStoresSection() {
  const { region, detectedCountryCode, source } = useRegion();

  const countryCode = detectedCountryCode ?? region.code;
  const { local, international, hasLocal } = getStoresSplit(countryCode);
  const storeRegion = getRegionByCountry(countryCode) ?? region;

  return (
    <section className="border-t py-20 md:py-28">
      <div className="container mx-auto px-4">
        <div className="mb-6">
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
            <Store className="h-6 w-6 text-primary" />
            Stores for you — local first
          </h2>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            {source === 'saved'
              ? `Using your saved country: ${storeRegion.name}. `
              : `Detected from your location: ${storeRegion.name}. `}
            Local stores first, then international retailers. These links open
            the store&apos;s own website — SmartBuy does not show prices, stock, or deals
            for these stores, and no partnership or affiliate relationship is claimed.
          </p>
        </div>

        <h3 className="mb-4 text-lg font-semibold">
          Local stores in {storeRegion.name}
        </h3>
        {!hasLocal && (
          <p className="mb-4 text-muted-foreground">
            No local stores are listed for {storeRegion.name} yet — international
            options are below.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {local.map((store) => (
            <StoreCard key={`local-${store.countryCode}-${store.slug}`} store={store} />
          ))}
        </div>

        <h3 className="mb-4 mt-10 text-lg font-semibold">
          International retailers (worldwide)
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {international.map((store) => (
            <StoreCard key={`intl-${store.countryCode}-${store.slug}`} store={store} />
          ))}
        </div>

        <p className="mt-8 text-muted-foreground">
          <Link href="/platforms" className="underline">
            See how every platform connects to SmartBuy
          </Link>
        </p>
      </div>
    </section>
  );
}
