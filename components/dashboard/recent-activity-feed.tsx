/**
 * Recent activity feed — Section 13, Chunk F, item 44.
 *
 * Merges client-side from 3 endpoints the dashboard / tracking
 * pages already call — GET /api/v1/tracking (saved products, by
 * addedAt), GET /api/v1/alerts/history?limit=20 (triggered alerts,
 * by sentAt), GET /api/v1/search-history?limit=5 (searches, by
 * createdAt) — newest first, each row linking to its product or
 * search. Any source may be passed in as a prop; a missing source
 * is fetched here so the feed also works standalone on the
 * tracking page (which does not fetch search history itself).
 *
 * Alert rows resolve their product link from the alerts list; an
 * unmatched alert id links to /dashboard/tracking, never to a
 * guessed product.
 */

'use client';

import { useRegion } from '@/components/region/region-provider';
import { tFor } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Heart, Bell, Search, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export interface ActivityTrackedItem {
  product: { name: string; slug: string };
  addedAt: string;
}

export interface ActivityAlert {
  id: string;
  productName: string;
  productSlug: string | null;
}

export interface ActivityAlertHistoryEntry {
  id: string;
  alertId: string;
  triggeredPrice: number;
  sentAt: string;
}

export interface ActivitySearchEntry {
  id: string;
  query: string;
  resultsCount: number;
  createdAt: string;
}

export type ActivityKind = 'saved' | 'alert' | 'search';

export interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  label: string;
  detail: string;
  href: string;
  at: string;
}

/**
 * Pure merge: one newest-first list across the three sources.
 * Entries with an unparseable date are dropped, never placed at a
 * guessed position.
 */
export function mergeActivityFeed(input: {
  items: ActivityTrackedItem[];
  alerts: ActivityAlert[];
  alertHistory: ActivityAlertHistoryEntry[];
  searches: ActivitySearchEntry[];
}): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  const alertById = new Map(input.alerts.map((a) => [a.id, a]));

  for (const item of input.items) {
    const at = new Date(item.addedAt);
    if (Number.isNaN(at.getTime())) continue;
    entries.push({
      id: `saved-${item.product.slug}-${item.addedAt}`,
      kind: 'saved',
      label: `Saved ${item.product.name}`,
      detail: 'Added to a wishlist',
      href: `/products/${item.product.slug}`,
      at: item.addedAt,
    });
  }

  for (const entry of input.alertHistory) {
    const at = new Date(entry.sentAt);
    if (Number.isNaN(at.getTime())) continue;
    const alert = alertById.get(entry.alertId);
    entries.push({
      id: `alert-${entry.id}`,
      kind: 'alert',
      label: alert ? `Alert triggered: ${alert.productName}` : 'Alert triggered',
      detail: `Price dropped to $${entry.triggeredPrice.toFixed(2)}`,
      href: alert?.productSlug ? `/products/${alert.productSlug}` : '/dashboard/tracking',
      at: entry.sentAt,
    });
  }

  for (const search of input.searches) {
    const at = new Date(search.createdAt);
    if (Number.isNaN(at.getTime())) continue;
    entries.push({
      id: `search-${search.id}`,
      kind: 'search',
      label: `Searched “${search.query}”`,
      detail: `${search.resultsCount} result${search.resultsCount === 1 ? '' : 's'}`,
      href: `/search?q=${encodeURIComponent(search.query)}`,
      at: search.createdAt,
    });
  }

  entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return entries;
}

const KIND_ICON: Record<ActivityKind, typeof Heart> = {
  saved: Heart,
  alert: Bell,
  search: Search,
};

export function RecentActivityFeed({
  items,
  alerts,
  alertHistory,
  searchHistory,
}: {
  items?: ActivityTrackedItem[];
  alerts?: ActivityAlert[];
  alertHistory?: ActivityAlertHistoryEntry[];
  searchHistory?: ActivitySearchEntry[];
}) {
  const { language } = useRegion();
  const [fetchedItems, setFetchedItems] = useState<ActivityTrackedItem[] | null>(null);
  const [fetchedAlerts, setFetchedAlerts] = useState<ActivityAlert[] | null>(null);
  const [fetchedHistory, setFetchedHistory] = useState<ActivityAlertHistoryEntry[] | null>(null);
  const [fetchedSearches, setFetchedSearches] = useState<ActivitySearchEntry[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const jobs: Array<Promise<void>> = [];
    if (items === undefined || alerts === undefined) {
      jobs.push(
        fetch('/api/v1/tracking')
          .then((res) => (res.ok ? res.json() : null))
          .then((json) => {
            if (cancelled || !json?.success || !json.data) return;
            if (items === undefined && Array.isArray(json.data.items)) setFetchedItems(json.data.items);
            if (alerts === undefined && Array.isArray(json.data.alerts)) setFetchedAlerts(json.data.alerts);
          })
          .catch(() => undefined)
      );
    }
    if (alertHistory === undefined) {
      jobs.push(
        fetch('/api/v1/alerts/history?limit=20')
          .then((res) => (res.ok ? res.json() : null))
          .then((json) => {
            if (!cancelled && json?.success && Array.isArray(json.data)) setFetchedHistory(json.data);
          })
          .catch(() => undefined)
      );
    }
    if (searchHistory === undefined) {
      jobs.push(
        fetch('/api/v1/search-history?limit=5')
          .then((res) => (res.ok ? res.json() : null))
          .then((json) => {
            if (!cancelled && json?.success && Array.isArray(json.data)) setFetchedSearches(json.data);
          })
          .catch(() => undefined)
      );
    }
    Promise.all(jobs).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // Re-fetch when a source switches from provided to missing:
    // the props are parent state (stable identities), and the
    // effect only fetches sources that are undefined, so listing
    // them cannot loop — it only re-runs when a prop changes.
  }, [items, alerts, alertHistory, searchHistory]);

  const resolvedItems = items ?? fetchedItems ?? [];
  const resolvedAlerts = alerts ?? fetchedAlerts ?? [];
  const resolvedHistory = alertHistory ?? fetchedHistory ?? [];
  const resolvedSearches = searchHistory ?? fetchedSearches ?? [];
  const allProvided =
    items !== undefined && alerts !== undefined && alertHistory !== undefined && searchHistory !== undefined;
  const entries = mergeActivityFeed({
    items: resolvedItems,
    alerts: resolvedAlerts,
    alertHistory: resolvedHistory,
    searches: resolvedSearches,
  }).slice(0, 10);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" aria-hidden="true" />
          {tFor(language, 'dashRecentActivity')}
        </CardTitle>
        <CardDescription>
          Your latest saves, alert triggers, and searches — newest first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading && !allProvided ? (
          <div className="glass-card animate-shimmer h-24" />
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No activity yet — save a product, set an alert, or run a search and it will show here.
          </p>
        ) : (
          <ul className="space-y-2">
            {entries.map((entry) => {
              const Icon = KIND_ICON[entry.kind];
              return (
                <li key={entry.id}>
                  <Link
                    href={entry.href}
                    className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{entry.label}</span>
                      <span className="block text-xs text-muted-foreground">{entry.detail}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {new Date(entry.at).toLocaleDateString()}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
