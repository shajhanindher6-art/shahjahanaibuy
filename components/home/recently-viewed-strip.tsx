'use client';

/**
 * "You recently viewed" strip (Section 11, Chunk C).
 *
 * Reads the guest view history from lib/recently-viewed.ts
 * (device-local localStorage — the same store the product page
 * records into on mount; signed-in views live in product_views
 * and are NOT shown here). Listens for the store's change event
 * (and cross-tab storage events) so a view recorded on a product
 * page appears without a reload when the visitor comes back.
 *
 * Honest empty state: renders nothing at all when there is no
 * history — never a fake strip, never invented products. A "Clear"
 * button wipes the device-local history. Prices show only when a
 * price was recorded with the view; otherwise no price line.
 *
 * Mounted on the homepage by the Section 11 coordinator (NOT here).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Clock, Package, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  clearRecentlyViewed,
  getRecentlyViewed,
  RECENTLY_VIEWED_EVENT,
  RECENTLY_VIEWED_KEY,
  type RecentlyViewedItem,
} from '@/lib/recently-viewed';

export function RecentlyViewedStrip() {
  const [items, setItems] = useState<RecentlyViewedItem[]>([]);

  useEffect(() => {
    const refresh = () => setItems(getRecentlyViewed());
    refresh();
    window.addEventListener(RECENTLY_VIEWED_EVENT, refresh);
    const onStorage = (e: StorageEvent) => {
      if (e.key === RECENTLY_VIEWED_KEY) refresh();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(RECENTLY_VIEWED_EVENT, refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Honest empty state: no history → no strip at all.
  if (items.length === 0) return null;

  return (
    <section aria-label="Recently viewed products">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Clock className="h-6 w-6 text-blue-600" />
          You recently viewed
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            clearRecentlyViewed();
            setItems([]);
          }}
        >
          <X className="mr-1 h-4 w-4" /> Clear history
        </Button>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Saved on this device only — sign in to keep your history across devices.
      </p>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {items.map((item) => (
          <Link
            key={item.id}
            href={`/products/${item.slug}`}
            className="w-48 flex-shrink-0 rounded-lg border bg-card p-3 transition-shadow hover:shadow-lg"
          >
            <div className="flex h-24 items-center justify-center overflow-hidden rounded-md bg-slate-100 dark:bg-slate-800">
              {item.imageUrl ? (
                // Lazy + sized raw img: product photos come from
                // arbitrary merchant hosts outside next.config.js
                // remotePatterns, so next/image would throw.
                <img
                  src={item.imageUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              ) : (
                <Package className="h-10 w-10 text-muted-foreground" />
              )}
            </div>
            <p className="mt-2 line-clamp-2 text-sm font-medium leading-tight">
              {item.name}
            </p>
            {item.brand && (
              <p className="mt-0.5 text-xs text-muted-foreground">{item.brand}</p>
            )}
            {item.price !== null && (
              <p className="mt-1 text-sm font-bold">${item.price.toFixed(2)}</p>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}
