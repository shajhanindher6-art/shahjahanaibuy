/**
 * Price History Graph — interactive price trend chart for a product.
 *
 * Unlike the older PriceChart (which renders the prediction API's
 * 30/90/365-day series), this component reads the real time-series
 * directly from GET /api/v1/products/[slug]/prices, which is backed
 * by the `price_history` table (migration 002, append-only rows of
 * product_id / retailer_id / price / recorded_at). No mock or fake
 * prices are generated: when a product has no price_history rows,
 * the empty state below is shown instead of an invented trend.
 *
 * Features: 7D / 30D / 90D / 1Y range selector, and stats computed
 * from the selected range — Current, Lowest, Highest, Average and
 * Change (last vs first point in range, in $ and %).
 *
 * Self-fetching client component, so the product page only has to
 * render <PriceHistoryGraph slug={slug} /> in its Price History tab.
 * A failed or slow prices request only empties this section; it
 * never blocks the rest of the page.
 */

'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { cn } from '@/lib/utils';

interface PricePoint {
  price: number;
  recordedAt: string;
}

interface PriceHistoryGraphProps {
  slug: string;
  className?: string;
}

type Range = '7d' | '30d' | '90d' | '1y';

const RANGES: Array<{ key: Range; label: string; days: number }> = [
  { key: '7d', label: '7 Days', days: 7 },
  { key: '30d', label: '30 Days', days: 30 },
  { key: '90d', label: '90 Days', days: 90 },
  { key: '1y', label: '1 Year', days: 365 },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function PriceHistoryGraph({ slug, className }: PriceHistoryGraphProps) {
  const [range, setRange] = useState<Range>('30d');
  const [points, setPoints] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setFailed(false);
      try {
        const res = await fetch(`/api/v1/products/${slug}/prices?limit=500`, {
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error('prices request failed');
        const data = await res.json();
        const history = (data?.data?.history ?? []) as Array<{
          price: number;
          recordedAt: string;
        }>;
        if (!cancelled) {
          // API returns newest-first; chart needs oldest-first.
          setPoints(
            history
              .map((h) => ({ price: Number(h.price), recordedAt: h.recordedAt }))
              .filter((h) => Number.isFinite(h.price) && h.recordedAt)
              .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime())
          );
        }
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
  }, [slug]);

  const rangeDays = RANGES.find((r) => r.key === range)?.days ?? 30;

  const chartData = useMemo(() => {
    const cutoff = Date.now() - rangeDays * 24 * 60 * 60 * 1000;
    return points
      .filter((p) => new Date(p.recordedAt).getTime() >= cutoff)
      .map((p) => ({ date: formatDate(p.recordedAt), price: p.price }));
  }, [points, rangeDays]);

  const stats = useMemo(() => {
    if (chartData.length === 0) return null;
    const prices = chartData.map((d) => d.price);
    const current = prices[prices.length - 1];
    const first = prices[0];
    const lowest = Math.min(...prices);
    const highest = Math.max(...prices);
    const average = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    const change = current - first;
    const changePct = first !== 0 ? (change / first) * 100 : 0;
    return { current, lowest, highest, average, change, changePct };
  }, [chartData]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (failed || points.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-center text-muted-foreground">
        <p>
          {failed
            ? 'Price history could not be loaded right now. Please try again later.'
            : 'No price history available yet for this product.'}
        </p>
      </div>
    );
  }

  return (
    <div className={className}>
      {/* Range selector */}
      <div className="mb-4 flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              range === r.key
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Stats for the selected range */}
      {stats ? (
        <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
          <div>
            <p className="text-xs text-muted-foreground">Current</p>
            <p className="text-lg font-semibold">${stats.current.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Lowest</p>
            <p className="text-lg font-semibold text-green-600">${stats.lowest.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Highest</p>
            <p className="text-lg font-semibold text-red-600">${stats.highest.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Average</p>
            <p className="text-lg font-semibold">${stats.average.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Change</p>
            <p
              className={cn(
                'flex items-center gap-1 text-lg font-semibold',
                stats.change >= 0 ? 'text-red-600' : 'text-green-600'
              )}
            >
              {stats.change >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
              {stats.change >= 0 ? '+' : ''}${stats.change.toFixed(2)} ({stats.changePct.toFixed(1)}%)
            </p>
          </div>
        </div>
      ) : (
        <p className="mb-4 text-sm text-muted-foreground">
          No price points in this range — try a longer range.
        </p>
      )}

      {/* Chart */}
      {chartData.length > 0 ? (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <defs>
                <linearGradient id="priceHistoryGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} interval="preserveStartEnd" stroke="#94a3b8" />
              <YAxis
                tick={{ fontSize: 12 }}
                stroke="#94a3b8"
                tickFormatter={(v: number) => `$${v}`}
                domain={['auto', 'auto']}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(255,255,255,0.95)',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  fontSize: '13px',
                }}
                formatter={(value: number) => [`$${value.toFixed(2)}`, 'Price']}
              />
              <Area
                type="monotone"
                dataKey="price"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="url(#priceHistoryGradient)"
                dot={false}
                activeDot={{ r: 5 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="flex h-64 items-center justify-center text-muted-foreground">
          No price data available for this range.
        </div>
      )}

      <p className="mt-2 text-xs text-muted-foreground">
        Based on {points.length} recorded price point{points.length === 1 ? '' : 's'} from the price_history table.
      </p>
    </div>
  );
}
