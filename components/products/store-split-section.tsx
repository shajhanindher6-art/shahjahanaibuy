/**
 * Section 8 — product-page store section: local first, then
 * international, both always shown.
 *
 * The visitor's country comes from IP detection (Vercel geo
 * header, via the RegionProvider) or from their own saved Country
 * Switcher choice — the saved choice always wins. The section
 * renders BOTH buckets, in this order:
 *   1. Local stores in the visitor's country (confirmed directory
 *      entries only; empty — with an honest note — when the
 *      country has none).
 *   2. International retailers (worldwide fallback, minus any
 *      store already shown as local, minus priced merchants).
 *
 * DIRECTORY + SEARCH LINKS ONLY: these are outbound links to the
 * stores' own search results for this product name. They carry NO
 * price, NO stock badge and NO discount: the store itself shows
 * its price and availability on its own site. Nothing here is a
 * SmartBuy price or deal, and no partnership or affiliate
 * relationship is claimed. Amazon/Best Buy are never listed here
 * (they are already the priced rows above); as a safety net, any
 * store whose name matches a priced merchant row is filtered out
 * of both buckets.
 *
 * Loaded with next/dynamic ssr:false from the product page so it
 * stays out of the First Load bundle (350 kB budget).
 */

'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { buildStoreSearchUrl, getStoresSplit, type LocalStore } from '@/lib/stores';
import { buildGoUrl } from '@/lib/affiliate-beacon';
import { geoSourceLabel, type GeoDetectionSource } from '@/lib/platform-geo';
import { checkoutHandoffHint } from '@/lib/local-payments';

export interface StoreSplitSectionProps {
  productName: string;
  countryCode: string;
  regionName: string;
  /** 'saved' = visitor's own choice, 'detected' = IP detection, 'fallback' = nothing resolved. */
  geoSource: 'saved' | 'detected' | 'fallback';
  /** Lower-cased merchant names already shown as priced rows. */
  pricedMerchantNames: string[];
  /** True when the merchants fetch failed, so filtering may be incomplete. */
  merchantsFailed: boolean;
}

function toGeoSource(source: StoreSplitSectionProps['geoSource']): GeoDetectionSource {
  if (source === 'detected') return 'ip';
  return source;
}

function StoreRow({
  store,
  productName,
}: {
  store: LocalStore;
  productName: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div>
        <p className="font-medium">{store.name}</p>
        <p className="text-sm text-muted-foreground">
          Search results on {store.name} — price and stock shown by the
          store, not by SmartBuy.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {checkoutHandoffHint(store, productName)}
        </p>
      </div>
      <Button asChild variant="outline">
        <a
          href={buildGoUrl(buildStoreSearchUrl(store, productName))}
          target="_blank"
          rel="noopener noreferrer"
        >
          Search on {store.name}
        </a>
      </Button>
    </div>
  );
}

export function StoreSplitSection({
  productName,
  countryCode,
  regionName,
  geoSource,
  pricedMerchantNames,
  merchantsFailed,
}: StoreSplitSectionProps) {
  const priced = new Set(pricedMerchantNames.map((name) => name.toLowerCase()));
  const { local, international, hasLocal } = getStoresSplit(countryCode);
  const visibleLocal = local.filter((store) => !priced.has(store.name.toLowerCase()));
  const visibleInternational = international.filter(
    (store) => !priced.has(store.name.toLowerCase())
  );

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle className="text-base">Where to buy — local first</CardTitle>
        <CardDescription>
          {geoSourceLabel(toGeoSource(geoSource), regionName)} SmartBuy does
          not show prices, stock, or deals for these stores — click through
          to see the store&apos;s own price and availability on its website.
          No partnership or affiliate relationship is claimed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {merchantsFailed && (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            Merchant data could not be loaded, so priced merchants could not
            be filtered out of this list — a store shown here may duplicate a
            priced row above.
          </p>
        )}

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">
            Local stores in {regionName}
          </h3>
          {!hasLocal && (
            <p className="text-sm text-muted-foreground">
              No local stores are listed for {regionName} yet — international
              options are below.
            </p>
          )}
          {visibleLocal.map((store) => (
            <StoreRow
              key={`local-${store.countryCode}-${store.slug}`}
              store={store}
              productName={productName}
            />
          ))}
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">
            International retailers (worldwide)
          </h3>
          {visibleInternational.map((store) => (
            <StoreRow
              key={`intl-${store.countryCode}-${store.slug}`}
              store={store}
              productName={productName}
            />
          ))}
        </div>

        <p className="text-sm text-muted-foreground">
          <Link href="/platforms" className="underline">
            See how every platform connects to SmartBuy
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
