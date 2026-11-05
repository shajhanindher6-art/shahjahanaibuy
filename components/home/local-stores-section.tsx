/**
 * Homepage Local Stores section — geo-targeted store directory.
 *
 * Shows the visitor's own country's stores from the real 70-store
 * directory (lib/stores.ts), or the worldwide retailer fallback
 * when their country has no confirmed local store yet (same
 * getStoresForCountry fallback as the product page).
 *
 * DIRECTORY + LINKS ONLY: these are links to the stores' own
 * homepages. SmartBuy shows no prices, stock, deals, or coupons
 * for these stores and claims no partnership or affiliate
 * relationship. There is no product on the homepage to search for,
 * so links go to the store homepage — not to a product search.
 */

'use client';

import { Store } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useRegion } from '@/components/region/region-provider';
import { getRegionByCountry } from '@/lib/region';
import { getStoresForCountry } from '@/lib/stores';

export function LocalStoresSection() {
  const { region, detectedCountryCode } = useRegion();

  const countryCode = detectedCountryCode ?? region.code;
  const { kind, stores } = getStoresForCountry(countryCode);
  const storeRegion = getRegionByCountry(countryCode) ?? region;
  const isLocal = kind === 'local';

  return (
    <section className="border-t py-20 md:py-28">
      <div className="container mx-auto px-4">
        <div className="mb-6">
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
            <Store className="h-6 w-6 text-primary" />
            {isLocal ? `Local stores in ${storeRegion.name}` : 'Global retailers (worldwide)'}
          </h2>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            {isLocal ? (
              <>
                Stores in {storeRegion.name} from our directory. These links open the
                store&apos;s own website — SmartBuy does not show prices, stock, or deals
                for these stores, and no partnership or affiliate relationship is claimed.
              </>
            ) : (
              <>
                No local stores are listed for your country yet. These are worldwide
                retailers — SmartBuy does not show prices, stock, or deals for these
                stores, and no partnership or affiliate relationship is claimed.
              </>
            )}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {stores.map((store) => (
            <Card key={`${store.countryCode}-${store.slug}`}>
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
          ))}
        </div>
      </div>
    </section>
  );
}
