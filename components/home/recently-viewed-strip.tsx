'use client';

/**
 * "You recently viewed" strip (Section 11, Chunk C).
 *
 * Reads the guest view history from lib/recently-viewed.ts
 * (device-local localStorage — the same store the product page
 * records into on mount) and, for signed-in visitors, merges it
 * with the account's product_views (Section 16, #38 — GET
 * /api/v1/product-views). Listens for the store's change event
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
import { useAuth } from '@/features/auth';
import {
  clearRecentlyViewed,
  getRecentlyViewed,
  RECENTLY_VIEWED_EVENT,
  RECENTLY_VIEWED_KEY,
  type RecentlyViewedItem,
} from '@/lib/recently-viewed';

export function RecentlyViewedStrip() {
  const { user } = useAuth();
  const [items, setItems] = useState<RecentlyViewedItem[]>([]);
  // Section 16, #38 — signed-in sync: the strip merges the
  // device-local list with the account's product_views (GET
  // /api/v1/product-views), most-recent-first, deduped by product
  // (the account row wins a duplicate — it carries the canonical
  // viewedAt). Guests keep the local-only list and the honest
  // "this device only" note. A failed server fetch falls back to
  // the local list silently — the strip never breaks on it.
  const [synced, setSynced] = useState(false);

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

  useEffect(() => {
    if (!user) {
      setSynced(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/v1/product-views');
        if (!res.ok) return;
        const data = await res.json();
        const serverItems = Array.isArray(data?.data)
          ? (data.data as RecentlyViewedItem[])
          : [];
        if (cancelled) return;
        setSynced(true);
        setItems((prev) => {
          const merged = [...serverItems];
          const seen = new Set(serverItems.map((i) => i.id));
          for (const item of prev) {
            if (!seen.has(item.id)) {
              merged.push(item);
              seen.add(item.id);
            }
          }
          return merged
            .sort((a, b) => (a.viewedAt < b.viewedAt ? 1 : a.viewedAt > b.viewedAt ? -1 : 0))
            .slice(0, 20);
        });
      } catch {
        // Local list stays — the strip never breaks on a failed sync.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

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
            // Section 16, #38 — signed-in users clear the account
            // history too, so cleared products do not reappear from
            // the server on the next load. A failed DELETE leaves
            // the local clear in place; the next sync re-reads the
            // truth.
            if (user) {
              void fetch('/api/v1/product-views', { method: 'DELETE' }).catch(() => undefined);
            }
            setItems([]);
          }}
        >
          <X className="mr-1 h-4 w-4" /> Clear history
        </Button>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        {synced
          ? 'Synced to your account — visible on any device you sign in on.'
          : 'Saved on this device only — sign in to keep your history across devices.'}
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
                // alt="" is deliberate, not missing: the product
                // name is rendered as the adjacent text below, so
                // a spoken alt would repeat it for screen readers.
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
