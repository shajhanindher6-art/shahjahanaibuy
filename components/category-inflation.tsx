/**
 * Category Inflation Index — self-fetching client component.
 *
 * Renders one trend badge per category from GET
 * /api/v1/category-inflation: the average per-product price change
 * over the trailing 90 days, from recorded price history only.
 * Rising averages read as "overhead" (prices up), falling ones as
 * "discounted" (prices down). Categories without enough recorded
 * prices render an honest "not enough data" row, never a number.
 */

'use client';

import { useEffect, useState } from 'react';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { cn } from '@/lib/utils';
import type { CategoryInflationEntry } from '@/services/category-inflation';

interface IndexResponse {
  entries: CategoryInflationEntry[];
  windowDays: number;
  historyDays: number;
  note?: string;
}

export function CategoryInflation({ className }: { className?: string }) {
  const [data, setData] = useState<IndexResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/v1/category-inflation', {
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error('category-inflation request failed');
        const json = await res.json();
        if (!cancelled) setData((json?.data ?? null) as IndexResponse | null);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Category Inflation Index</CardTitle>
        <CardDescription>
          Average per-product price change over the trailing 90 days, from recorded price
          history only — not a forecast.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex h-24 items-center justify-center">
            <LoadingSpinner size="lg" />
          </div>
        ) : failed || !data ? (
          <p className="text-sm text-muted-foreground">
            Category inflation data is unavailable right now. Please try again later.
          </p>
        ) : data.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No category has enough recorded price history yet for an index.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {data.entries.map((entry) => (
              <li key={entry.category} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{entry.category}</span>
                {entry.status === 'ok' && entry.avgChangePct !== null ? (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                      entry.direction === 'up' && 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
                      entry.direction === 'down' && 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
                      entry.direction === 'flat' && 'bg-muted text-muted-foreground dark:bg-muted dark:text-muted-foreground'
                    )}
                  >
                    {entry.direction === 'up' ? (
                      <TrendingUp className="h-3.5 w-3.5" />
                    ) : entry.direction === 'down' ? (
                      <TrendingDown className="h-3.5 w-3.5" />
                    ) : (
                      <Minus className="h-3.5 w-3.5" />
                    )}
                    {entry.avgChangePct > 0 ? '+' : ''}
                    {entry.avgChangePct.toFixed(1)}%
                    <span className="font-normal">
                      {entry.direction === 'up'
                        ? 'overhead'
                        : entry.direction === 'down'
                          ? 'discounted'
                          : 'flat'}
                    </span>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Not enough recorded prices yet
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {entry.productsUsed} product{entry.productsUsed === 1 ? '' : 's'} ·{' '}
                  {entry.pointsUsed} price point{entry.pointsUsed === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>
        )}
        {!loading && data && data.historyDays > 0 && (
          <p className="mt-4 text-xs text-muted-foreground">
            Based on {data.historyDays} day{data.historyDays === 1 ? '' : 's'} of recorded
            price history. A category needs at least 2 products with recorded price
            changes before an average is shown.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
