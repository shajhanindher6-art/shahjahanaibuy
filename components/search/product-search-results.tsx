/**
 * Local-first search results — tabbed local vs global retailers.
 *
 * Rendered below the existing search results on /search. The
 * parent fetches /api/search after the main ai-search call and
 * passes the split data here; this component never fetches and
 * never changes the existing results, filters, or sort.
 *
 * HONESTY RULES (do not weaken them):
 * - Local stores are SEARCH LINKS only. No price, stock, discount,
 *   deal, or rating exists for them, so none is ever rendered.
 * - Global products show their real recorded price only; a product
 *   with no recorded price reads "Price not listed", never a
 *   guessed price.
 * - When fallbackTriggered is true, the Global tab is active by
 *   default and the fallback notice below is shown verbatim.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Globe, MapPin, Search, Store } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Price } from '@/components/region/price';
import type {
  GlobalResultEntry,
  LocalFirstSearchData,
  LocalStoreLink,
} from '@/services/local-first-search';
import { LOCAL_FIRST_FALLBACK_NOTICE } from '@/services/local-first-search';

type TabValue = 'local' | 'global';

interface ProductSearchResultsProps {
  /** Split data from /api/search; null while the fetch has not returned. */
  data: LocalFirstSearchData | null;
  /** True while /api/search is in flight. */
  loading: boolean;
  /**
   * True when the /api/search fetch itself failed. Renders nothing
   * so a failure here never disturbs the existing search results.
   */
  error?: boolean;
}

function StoreLinkCard({ store, query }: { store: LocalStoreLink; query: string }) {
  let hostname = store.websiteUrl;
  try {
    hostname = new URL(store.websiteUrl).hostname;
  } catch {
    // Keep the raw URL when it cannot be parsed — never crash a card.
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{store.storeName}</CardTitle>
        <CardDescription>{hostname}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <a href={store.searchUrl} target="_blank" rel="noopener noreferrer">
            Search for &ldquo;{query}&rdquo; at {store.storeName}
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}

export function ProductSearchResults({ data, loading, error }: ProductSearchResultsProps) {
  const [tab, setTab] = useState<TabValue>('local');

  // Fallback auto-switch: when the country has no confirmed local
  // store, focus starts on the Global tab. Synced on every new
  // search result (the parent also remounts per query via key).
  useEffect(() => {
    if (data) setTab(data.fallbackTriggered ? 'global' : 'local');
  }, [data]);

  if (error) return null;
  if (loading && !data) {
    return (
      <div className="mt-8 grid gap-4" aria-label="Loading local-first results">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoadingSpinner size="sm" />
          Finding local and global stores for your region…
        </div>
      </div>
    );
  }
  if (!data) return null;

  const products = data.globalResults.filter(
    (e): e is Extract<GlobalResultEntry, { kind: 'product' }> => e.kind === 'product'
  );
  const globalStoreLinks = data.globalResults.filter(
    (e): e is Extract<GlobalResultEntry, { kind: 'store-link' }> => e.kind === 'store-link'
  );

  return (
    <div className="mt-8 grid gap-4">
      {/* Region / currency banner — the detected country drives both tabs. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 px-4 py-3 text-sm">
        <MapPin className="h-4 w-4 text-primary" />
        <span>
          Showing results for <strong>{data.countryName}</strong> ({data.country})
        </span>
        <span className="text-muted-foreground">·</span>
        <span>
          Prices in <strong>{data.currency}</strong>
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">
          Local stores are shown first; store links open the store&apos;s own search results.
        </span>
      </div>

      {data.fallbackTriggered && (
        <div
          role="status"
          className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          {LOCAL_FIRST_FALLBACK_NOTICE}
        </div>
      )}

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as TabValue)}
        className="grid gap-4"
      >
        <TabsList className="w-full justify-start">
          <TabsTrigger value="local">
            <Store className="mr-1.5 h-4 w-4" />
            Local Stores (Domestic)
            {data.localResults.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {data.localResults.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="global">
            <Globe className="mr-1.5 h-4 w-4" />
            Global &amp; Import (Landed Cost)
          </TabsTrigger>
        </TabsList>

        <TabsContent value="local" className="grid gap-4">
          {data.localResults.length === 0 ? (
            <EmptyState
              title={`No local stores for ${data.countryName} yet`}
              description="We have no confirmed local store for your country in our directory, so the Global tab shows international import options instead. Local store links never carry prices or stock here — those are shown on the store's own site."
              icon={Store}
            />
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Stores in {data.countryName} from our directory. These links open the
                store&apos;s own search results for &ldquo;{data.query}&rdquo; — prices and
                stock are shown on the store&apos;s site, not here, and no partnership or
                affiliate relationship is claimed.
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.localResults.map((store) => (
                  <StoreLinkCard
                    key={`${store.countryCode}-${store.storeSlug}`}
                    store={store}
                    query={data.query}
                  />
                ))}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="global" className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            Landed cost includes estimated duty + tax — see the calculator on the product
            page.
          </p>
          {products.length === 0 ? (
            <EmptyState
              title="No catalog products matched"
              description={`No products in our catalog matched "${data.query}". Try the global store links below — they open each retailer's own search results.`}
              icon={Search}
            />
          ) : (
            <div className="grid gap-4">
              {products.map((product) => (
                <Card key={product.id}>
                  <CardContent className="flex gap-4 p-4">
                    <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-lg bg-muted">
                      {product.imageUrl ? (
                        // Lazy + explicitly sized (Section 10,
                        // 2026-11-11): these thumbnails sit below the
                        // fold in the Global tab and must not block
                        // first paint or shift layout while loading.
                        // next/image is NOT used here on purpose:
                        // next.config.js only allowlists
                        // images.unsplash.com / images.pexels.com,
                        // and these are arbitrary merchant URLs, so
                        // next/image would reject them.
                        // eslint-disable-next-line @next/next/no-img-element -- remote merchant image; next/image remotePatterns allows only Unsplash + Pexels
                        <img
                          src={product.imageUrl}
                          alt={product.name}
                          width={96}
                          height={96}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                          <Search className="h-8 w-8" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <Link href={`/products/${product.slug}`}>
                            <h3 className="font-semibold text-lg leading-tight hover:underline">
                              {product.name}
                            </h3>
                          </Link>
                          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                            {product.brand && <span>{product.brand}</span>}
                            {product.category && (
                              <>
                                <span>·</span>
                                <span>{product.category}</span>
                              </>
                            )}
                            {product.stores.length > 0 && (
                              <>
                                <span>·</span>
                                <span>Available at: {product.stores.join(', ')}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {product.priceUsd !== null && product.priceUsd !== undefined ? (
                            <Price usd={product.priceUsd} className="text-lg font-bold text-blue-600" />
                          ) : (
                            <span className="text-xs text-muted-foreground">Price not listed</span>
                          )}
                          <Badge variant="secondary">{Math.round(product.score)}% search match</Badge>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <div>
            <h3 className="text-base font-semibold">Global store links</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Worldwide retailers — search links only. Prices and stock are shown on the
              retailer&apos;s own site, not here.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {globalStoreLinks.map((store) => (
              <StoreLinkCard
                key={`${store.countryCode}-${store.storeSlug}`}
                store={store}
                query={data.query}
              />
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
