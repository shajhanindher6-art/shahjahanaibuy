/**
 * Your lists at a glance — Section 13, Chunk F, item 42.
 *
 * Per-list breakdown (item count, summed current price, "X
 * unpriced") from the same GET /api/v1/tracking payload the
 * dashboard already fetches — wishlistId + wishlistName +
 * currentPrice on each TrackedItem. Distinct from TechBudgetWidget,
 * which shows only one aggregate total across all lists.
 *
 * The summed price is a plain sum of the recorded current prices
 * of the priced items in that list; unpriced items are counted,
 * never valued at $0.
 */

'use client';

import { useRegion } from '@/components/region/region-provider';
import { tFor } from '@/lib/i18n';
import Link from 'next/link';
import { Heart } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/** Minimal shape of one TrackedItem from GET /api/v1/tracking. */
export interface ListGlanceItem {
  wishlistId: string;
  wishlistName: string;
  currentPrice: number | null;
}

export interface ListGlance {
  wishlistId: string;
  wishlistName: string;
  itemCount: number;
  totalCurrentPrice: number;
  unpricedCount: number;
}

/** Pure grouping: one entry per wishlist, in first-seen order. */
export function groupItemsByList(items: ListGlanceItem[]): ListGlance[] {
  const byId = new Map<string, ListGlance>();
  for (const item of items) {
    const existing = byId.get(item.wishlistId);
    if (existing) {
      existing.itemCount += 1;
      if (item.currentPrice === null) existing.unpricedCount += 1;
      else existing.totalCurrentPrice += item.currentPrice;
    } else {
      byId.set(item.wishlistId, {
        wishlistId: item.wishlistId,
        wishlistName: item.wishlistName,
        itemCount: 1,
        totalCurrentPrice: item.currentPrice ?? 0,
        unpricedCount: item.currentPrice === null ? 1 : 0,
      });
    }
  }
  return [...byId.values()];
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function ListsAtAGlance({ items, loading = false }: { items: ListGlanceItem[]; loading?: boolean }) {
  const { language } = useRegion();
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{tFor(language, 'dashListsAtAGlance')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="glass-card animate-shimmer h-24" />
        </CardContent>
      </Card>
    );
  }

  const lists = groupItemsByList(items);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Heart className="h-5 w-5" aria-hidden="true" />
          {tFor(language, 'dashListsAtAGlance')}
        </CardTitle>
        <CardDescription>
          What each wishlist holds and what its priced items cost right now.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {lists.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No lists yet — save a product to a wishlist and it will appear here.
          </p>
        ) : (
          <ul className="space-y-3">
            {lists.map((list) => (
              <li key={list.wishlistId} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <Link href="/dashboard/wishlists" className="min-w-0 hover:underline">
                  <span className="block truncate text-sm font-semibold">{list.wishlistName}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {list.itemCount} item{list.itemCount === 1 ? '' : 's'}
                    {list.unpricedCount > 0 && ` · ${list.unpricedCount} unpriced`}
                  </span>
                </Link>
                <Badge variant="secondary" className="shrink-0">
                  {list.unpricedCount === list.itemCount ? 'No prices yet' : formatUsd(list.totalCurrentPrice)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
