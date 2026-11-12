'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Clock, Home, RefreshCw, Search, Wrench, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { tFor } from '@/lib/i18n';
import { useRegion } from '@/components/region/region-provider';
import {
  getRecentlyViewed,
  type RecentlyViewedItem,
} from '@/lib/recently-viewed';

/**
 * Offline page (Section 4 item 6 + S2#29, deepened Section 14, P-2).
 * Served by the service worker (public/sw.js) when a navigation
 * fails while offline. Beyond the original "you're offline, retry
 * or go home", this page is now useful while the visitor waits:
 *
 * - Live connection status: it listens for the browser's `online`
 *   event and reloads automatically the moment the connection
 *   comes back (plus a manual Try Again), so nobody has to keep
 *   tapping retry. The status line says plainly whether the
 *   browser thinks it is online or offline.
 * - Recently viewed, from this device: products the visitor
 *   opened before are read from device-local localStorage
 *   (lib/recently-viewed.ts — the same store the homepage strip
 *   uses; nothing is fetched). Each links back to its product
 *   page, labelled as "may open from cache" — a product page
 *   only opens offline if it was visited before and is still
 *   cached; otherwise the tap fails the same way this page did,
 *   and the label says so instead of promising.
 * - Quick links to the pages most likely to be cached (Home,
 *   Deals, Tools) for the same reason — no claim they WILL open,
 *   only that they are the best bets.
 * - An honest recap of what works offline (visited pages and
 *   their images) and what does not (live prices, search,
 *   compare, alerts, retailer links — never served stale).
 *
 * Nothing here invents data: no recently-viewed history means no
 * section at all, never placeholder products.
 */
export default function OfflinePage() {
  // Section 16, #42: the static labels below render through tFor
  // (existing keys only) like the deals page.
  const { language } = useRegion();
  const [online, setOnline] = useState(false);
  const [recent, setRecent] = useState<RecentlyViewedItem[]>([]);

  useEffect(() => {
    setOnline(window.navigator.onLine);
    setRecent(getRecentlyViewed().slice(0, 5));
    const onOnline = () => {
      setOnline(true);
      // The connection is back — reload to the page the visitor
      // actually wanted instead of leaving them on this page.
      window.location.reload();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/50 px-4 py-12 dark:bg-background">
      <div className="flex w-full max-w-lg flex-col items-center gap-4 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
          <WifiOff className="h-10 w-10 text-muted-foreground" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">You&apos;re Offline</h1>
          <p className="mt-2 text-muted-foreground">
            You appear to have lost your internet connection. Live prices,
            search, and alerts need the network — but pages you have
            already visited may still open from your device&apos;s cache.
          </p>
          <p className="mt-2 text-sm text-muted-foreground" role="status">
            {online
              ? 'Your connection is back — reloading…'
              : 'Status: offline. This page reloads itself as soon as your connection returns.'}
          </p>
        </div>
        <div className="flex gap-3">
          <Button onClick={() => window.location.reload()} variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" /> {tFor(language, 'commonTryAgain')}
          </Button>
          <Button asChild>
            <Link href="/">
              <Home className="mr-2 h-4 w-4" /> Go Home
            </Link>
          </Button>
        </div>
      </div>

      {recent.length > 0 ? (
        <section
          aria-label="Recently viewed products"
          className="w-full max-w-lg rounded-lg border bg-card p-6 text-left"
        >
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Clock className="h-5 w-5 text-blue-600" /> Recently viewed on this device
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            These may open from your device&apos;s cache — a product opens
            offline only if you visited it before. Saved on this device
            only.
          </p>
          <ul className="mt-4 space-y-2">
            {recent.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/products/${item.slug}`}
                  className="block rounded-md border px-3 py-2 text-sm font-medium underline-offset-4 hover:underline"
                >
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section
        aria-label="Pages that may still open"
        className="w-full max-w-lg rounded-lg border bg-card p-6 text-left"
      >
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Wrench className="h-5 w-5 text-blue-600" /> Try a page you have already visited
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Only pages you opened before can come back from the cache —
          nothing here is guaranteed offline.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/">{tFor(language, 'navHome')}</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/deals">{tFor(language, 'navDeals')}</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/tools">{tFor(language, 'toolsHubTitle')}</Link>
          </Button>
        </div>
        <p className="mt-4 flex items-start gap-2 text-sm text-muted-foreground">
          <Search className="mt-0.5 h-4 w-4 shrink-0" />
          Search, compare, live prices and price-drop alerts need a
          connection — prices are never served stale from the cache.
        </p>
      </section>
    </div>
  );
}
