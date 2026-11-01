/**
 * Price Trend Sparkline — compact Recharts trend line for cards.
 *
 * Reuses the same real data source as PriceHistoryGraph:
 * GET /api/v1/products/[slug]/prices, backed by the `price_history`
 * table. No prices are invented: with fewer than 2 points, or on a
 * failed request, it renders nothing (the parent card shows its own
 * price text instead of a fake trend).
 *
 * Colour follows the price direction, not a generic brand colour:
 * green when the price fell over the shown window (good for the
 * buyer), red when it rose, slate when flat. The % change is shown
 * only when `showChange` is set, so the component stays tiny in
 * dense grids.
 *
 * Self-fetching client component, so any card only has to render
 * <PriceTrendSparkline slug={slug} /> — it never blocks the card.
 */

'use client';

import { useState, useEffect, useMemo } from 'react';
import { Line, LineChart, ResponsiveContainer } from 'recharts';
import { cn } from '@/lib/utils';

interface PriceTrendSparklineProps {
  slug: string;
  className?: string;
  showChange?: boolean;
}

export function PriceTrendSparkline({ slug, className, showChange = false }: PriceTrendSparklineProps) {
  const [points, setPoints] = useState<number[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/v1/products/${slug}/prices?limit=60`, {
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error('prices request failed');
        const data = await res.json();
        const history = (data?.data?.history ?? []) as Array<{ price: number; recordedAt: string }>;
        if (!cancelled) {
          setPoints(
            history
              .map((h) => Number(h.price))
              .filter((p) => Number.isFinite(p))
              .reverse() // API is newest-first; sparkline needs oldest-first.
              .slice(-30) // Last 30 points at most — a sparkline, not the full chart.
          );
        }
      } catch {
        if (!cancelled) setPoints([]);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const changePct = useMemo(() => {
    if (points.length < 2 || points[0] === 0) return null;
    return ((points[points.length - 1] - points[0]) / points[0]) * 100;
  }, [points]);

  if (!loaded || points.length < 2) return null;

  const fell = (changePct ?? 0) < 0;
  const stroke = fell ? '#16a34a' : (changePct ?? 0) > 0 ? '#dc2626' : '#64748b';
  const chartData = points.map((price, i) => ({ i, price }));

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="h-10 w-28 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
            <Line type="monotone" dataKey="price" stroke={stroke} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {showChange && changePct !== null && (
        <span className={cn('text-xs font-medium', fell ? 'text-green-600' : changePct > 0 ? 'text-red-600' : 'text-muted-foreground')}>
          {changePct >= 0 ? '+' : ''}
          {changePct.toFixed(1)}%
        </span>
      )}
    </div>
  );
}
