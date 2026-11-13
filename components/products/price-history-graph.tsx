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
 * Change (last vs first point in range, in the recorded currency
 * and %). The chart also
 * marks the range average (dashed line) and the lowest point in the
 * range (green "Lowest" dot), so a price drop / best-buy moment is
 * visible at a glance instead of only in the stats row.
 *
 * Self-fetching client component, so the product page only has to
 * render <PriceHistoryGraph slug={slug} /> in its Price History tab.
 * A failed or slow prices request only empties this section; it
 * never blocks the rest of the page.
 */

'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Area, AreaChart, CartesianGrid, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  computePriceDrops,
  computeTrendStats,
  filterPointsByRange,
  movingAverage,
  MOVING_AVERAGE_WINDOW_DAYS,
  type TrendPoint,
} from '@/lib/price-trend';
import {
  gateTrendStats,
  getHistoryProvenance,
} from '@/lib/price-history-gates';

interface PricePoint {
  price: number;
  recordedAt: string;
  // Sections 21–25, Stage H (H-P2-9) — the recorded currency of
  // this point, verbatim from GET /api/v1/products/[slug]/prices
  // (`price_history.currency`). Null when the API row carried none.
  currency: string | null;
  // FINAL 100% (W3, F-P1-37/F-P1-38) — migration 057 source,
  // when recorded. Null pre-057: the point's origin is then
  // derived from the 057 backfill rule (recorded before
  // 2026-11-03 = seed) by getHistoryProvenance, never guessed.
  source: string | null;
}

interface PriceHistoryGraphProps {
  slug: string;
  className?: string;
}

type Range = '7d' | '30d' | '90d' | '1y' | 'all';

// days: null = all recorded history (no cutoff) — the only range
// guaranteed to show every recorded point, however thin the data is.
const RANGES: Array<{ key: Range; label: string; days: number | null }> = [
  { key: '7d', label: '7 Days', days: 7 },
  { key: '30d', label: '30 Days', days: 30 },
  { key: '90d', label: '90 Days', days: 90 },
  { key: '1y', label: '1 Year', days: 365 },
  { key: 'all', label: 'All History', days: null },
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
        // limit=100 matches the prices API's default cache key, so this
        // fetch shares the server cache with other price queries instead
        // of opening a separate 500-row cache entry.
        const res = await fetch(`/api/v1/products/${slug}/prices?limit=100`, {
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error('prices request failed');
        const data = await res.json();
        const history = (data?.data?.history ?? []) as Array<{
          price: number;
          recordedAt: string;
          currency?: string | null;
          source?: string | null;
        }>;
        if (!cancelled) {
          // API returns newest-first; chart needs oldest-first.
          // The currency rides along (H-P2-9) — dropping it here
          // is what made every price render with a hard-coded $.
          // The source rides along too (FINAL 100%, W3 F-P1-38)
          // so the chart can label seed-origin history.
          setPoints(
            history
              .map((h) => ({
                price: Number(h.price),
                recordedAt: h.recordedAt,
                currency:
                  typeof h.currency === 'string' && h.currency.trim() !== ''
                    ? h.currency.trim().toUpperCase()
                    : null,
                source: typeof h.source === 'string' ? h.source : null,
              }))
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

  // Sections 21–25, Stage H (H-P2-9) — the currency the chart
  // prices in: the single distinct recorded currency across the
  // loaded points, or null when points are mixed / unrecorded.
  // Nothing is ever assumed to be dollars — a bare number with
  // no symbol is more honest than a $ that was never recorded.
  const currencies = useMemo(() => {
    const set = new Set<string>();
    for (const p of points) if (p.currency) set.add(p.currency);
    return [...set].sort();
  }, [points]);
  const displayCurrency = currencies.length === 1 ? currencies[0] : null;
  const formatMoney = useCallback(
    (value: number) => {
      if (displayCurrency) {
        try {
          return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: displayCurrency,
          }).format(value);
        } catch {
          // Invalid recorded code — fall through to the bare number.
        }
      }
      return value.toFixed(2);
    },
    [displayCurrency]
  );

  // Actual recorded points inside the selected range (oldest-first).
  // No interpolation, no synthesized points: a thin range honestly
  // shows only its few real points.
  const rangedPoints = useMemo(
    () => filterPointsByRange(points, rangeDays),
    [points, rangeDays]
  );

  // 30-day trailing moving average, computed from ALL loaded points
  // (not just the selected range) so the trailing window genuinely
  // reaches 30 days back even in the 7-day view. Keyed by the same
  // per-day date label the chart uses; a day with no average keeps
  // no value, so the line honestly breaks instead of inventing one.
  const maByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const ma of movingAverage(points)) {
      map.set(formatDate(ma.date), ma.avg);
    }
    return map;
  }, [points]);

  const chartData = useMemo(() => {
    // Aggregate to one point per calendar day (latest point of the day
    // wins, points are oldest-first). Without this, several rows on the
    // same day produced duplicate X-axis labels (e.g. "Oct 31" twice)
    // and made the Lowest ReferenceDot's x-position ambiguous on a
    // categorical axis, so the dot could not be seen on the chart.
    const byDay = new Map<string, number>();
    for (const p of rangedPoints) {
      byDay.set(formatDate(p.recordedAt), p.price);
    }
    return Array.from(byDay, ([date, price]) => ({ date, price, ma: maByDate.get(date) }));
  }, [rangedPoints, maByDate]);

  // How many chart days actually carry an average — the overlay line
  // renders only when there are at least 2, so a single averaged
  // point never draws a misleading one-point "line".
  const maPointCount = useMemo(
    () => chartData.filter((d) => Number.isFinite(d.ma)).length,
    [chartData]
  );

  // Real point-to-point decreases inside the range, from the raw
  // recorded points (not the per-day aggregation). Empty = no drops
  // recorded, rendered as an honest empty state below.
  const priceDrops = useMemo(() => computePriceDrops(rangedPoints), [rangedPoints]);

  const stats = useMemo(() => {
    if (chartData.length === 0) return null;
    // FINAL 100% (W3, F-P2-22) — trend stats need the unified
    // gate (5 recorded points in range, fresh latest point). A
    // 1-point "trend" used to render Change 0 / Average = the
    // point as if it meant something. Gated ranges show the
    // reason instead of the stats grid (see the render below).
    if (gateTrendStats(rangedPoints).stats === null) return null;
    const base = computeTrendStats(chartData.map((d) => ({ price: d.price, recordedAt: d.date })));
    if (!base) return null;
    // Date of the lowest point in range, for the "best price" marker.
    // chartData is oldest-first, so the first occurrence wins on ties.
    const lowestPoint = chartData.reduce((min, d) => (d.price < min.price ? d : min), chartData[0]);
    return { ...base, lowestDate: lowestPoint.date };
  }, [chartData, rangedPoints]);

  // FINAL 100% (W3, F-P1-38/F-P2-22) — the gate verdict and the
  // seed-origin verdict for this series, computed from the raw
  // recorded points (not the per-day aggregation).
  const trendGate = useMemo(() => gateTrendStats(rangedPoints), [rangedPoints]);
  const provenance = useMemo(() => getHistoryProvenance(points), [points]);

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
          <Button
            key={r.key}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRange(r.key)}
            className={cn(
              'h-auto rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              range === r.key
                ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-600 hover:text-white'
                : 'bg-muted text-foreground hover:bg-accent'
            )}
          >
            {r.label}
          </Button>
        ))}
      </div>

      {/* Stats for the selected range */}
      {/* FINAL 100% (W3, F-P1-38) — seed-origin label. The live
          catalog's history is the launch demo seed (×1.05/×1.02/
          ×1.00/×1.00 factors): its −4.76% change, two "price
          drops", moving-average line and "Lowest" dot are
          seed-constructed, not market movement. The label shows
          whenever the series is seed-origin (or mixed with seed
          points); a fully live series shows nothing here. */}
      {provenance.label && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {provenance.label}
        </p>
      )}
      {currencies.length === 0 ? (
        <p className="mb-4 text-xs text-muted-foreground">
          Currency was not recorded for these prices — amounts are shown without a currency.
        </p>
      ) : currencies.length > 1 ? (
        <p className="mb-4 text-xs text-muted-foreground">
          Prices recorded in multiple currencies ({currencies.join(', ')}) — amounts are shown in
          their recorded currency.
        </p>
      ) : null}
      {/* FINAL 100% (W3, F-P2-22) — trend stats are gated: below
          5 recorded points in range, or with a stale latest point,
          the numbers are withheld and the reason is shown instead
          of a 1-point "Change 0". When stats ARE shown they carry
          a freshness label: the latest point's age, so a stale
          −4.76% never reads as current. */}
      {stats && trendGate.gate.ageDays !== null && (
        <p className="mb-4 text-xs text-muted-foreground">
          Latest recorded point{' '}
          {trendGate.gate.lastRecordedAt
            ? new Date(trendGate.gate.lastRecordedAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })
            : 'unknown'}
          {` (${trendGate.gate.ageDays} day${trendGate.gate.ageDays === 1 ? '' : 's'} ago)`}
          {trendGate.gate.ageDays > 7
            ? ' — stale, so these numbers may be out of date.'
            : '.'}
        </p>
      )}
      {trendGate.gate.gated && chartData.length > 0 ? (
        <p className="mb-4 rounded-md border p-3 text-sm text-muted-foreground">
          Trend stats withheld: {trendGate.gate.reason}
        </p>
      ) : stats ? (
        <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <p className="text-xs text-muted-foreground">Current</p>
            <p className="text-lg font-semibold">{formatMoney(stats.current)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Lowest</p>
            <p className="text-lg font-semibold text-green-600">{formatMoney(stats.lowest)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Highest</p>
            <p className="text-lg font-semibold text-red-600">{formatMoney(stats.highest)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Average</p>
            <p className="text-lg font-semibold">{formatMoney(stats.average)}</p>
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
              {stats.change >= 0 ? '+' : ''}
              {formatMoney(stats.change)} ({stats.changePercent.toFixed(1)}%)
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Above lowest</p>
            <p className="text-lg font-semibold">
              {stats.vsLowestAmount === 0
                ? 'At lowest'
                : `+${formatMoney(stats.vsLowestAmount)} (${stats.vsLowestPercent.toFixed(1)}%)`}
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
                tickFormatter={(v: number) => formatMoney(v)}
                domain={['auto', 'auto']}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(255,255,255,0.95)',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  fontSize: '13px',
                }}
                formatter={(value: number, name?: string) => [
                  formatMoney(value),
                  name === 'ma' ? `${MOVING_AVERAGE_WINDOW_DAYS}-day moving average` : 'Price',
                ]}
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
              {/* 30-day moving-average overlay: dashed amber line, only
                  when at least 2 chart days carry an average. Missing
                  values break the line (connectNulls stays false) —
                  a gap means "no average for that day", never a
                  filled-in estimate. */}
              {maPointCount >= 2 && (
                <Line
                  type="monotone"
                  dataKey="ma"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  strokeDasharray="5 3"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              )}
              {/* Reference markers AFTER the Area, so they render on top
                  of the area fill instead of being painted over by it —
                  that was why the green Lowest dot was not visible on a
                  flat line in the live audit, even though the Lowest
                  stat value above the chart was green. */}
              {stats && (
                <ReferenceLine
                  y={stats.average}
                  stroke="#94a3b8"
                  strokeDasharray="3 3"
                  label={{ value: 'Avg', position: 'insideTopRight', fontSize: 11, fill: '#94a3b8' }}
                />
              )}
              {stats && (
                <ReferenceDot
                  x={stats.lowestDate}
                  y={stats.lowest}
                  r={7}
                  fill="#16a34a"
                  stroke="#ffffff"
                  strokeWidth={3}
                  label={{ value: 'Lowest', position: 'top', fontSize: 11, fill: '#16a34a', fontWeight: 600 }}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="flex h-64 items-center justify-center text-muted-foreground">
          No price data available for this range.
        </div>
      )}

      {/* Legend for the overlay. When the history is too thin for an
          average, the note says so plainly — no line, no placeholder. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5 bg-blue-500" aria-hidden />
          Price
        </span>
        {maPointCount >= 2 ? (
          <>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0 w-5 border-t-2 border-dashed border-amber-500" aria-hidden />
              {MOVING_AVERAGE_WINDOW_DAYS}-day moving average
            </span>
            <span>Average of recorded prices only — a trend view, not a forecast.</span>
          </>
        ) : (
          <span>
            Not enough recorded history for a {MOVING_AVERAGE_WINDOW_DAYS}-day moving average yet.
          </span>
        )}
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Showing {rangedPoints.length} recorded price point{rangedPoints.length === 1 ? '' : 's'} in this
        range ({points.length} total) from the price_history table. Only actual recorded points are
        shown — no interpolated or estimated prices.
      </p>

      {/* Price drop history — real point-to-point decreases only. */}
      <div className="mt-6">
        <h4 className="mb-2 text-sm font-semibold">Price drop history</h4>
        {priceDrops.length > 0 ? (
          <ul className="space-y-1.5">
            {priceDrops.map((drop, i) => (
              <li key={`${drop.date}-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">{formatDate(drop.date)}</span>
                <span className="line-through text-muted-foreground">{formatMoney(drop.oldPrice)}</span>
                <span aria-hidden>→</span>
                <span className="font-semibold text-green-600">{formatMoney(drop.newPrice)}</span>
                <span className="font-medium text-green-600">
                  −{formatMoney(drop.dropAmount)} (−{drop.dropPercent.toFixed(1)}%)
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No price drops recorded in this range.
          </p>
        )}
      </div>
    </div>
  );
}
