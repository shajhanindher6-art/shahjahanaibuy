/**
 * Forecast card — probabilistic price forecast for one product.
 *
 * Self-fetching client component: reads GET /api/v1/forecast/[slug],
 * which is computed ONLY from the product's recorded price history.
 * Renders one row per horizon (7 / 30 / 90 days) with the forecast
 * RANGE and confidence %, plus the 30-day backtest line. Never an
 * exact future price or date.
 *
 * States, all honest:
 * - loading → skeleton lines (never a fake range while loading).
 * - fetch failure → "Forecast unavailable right now" (page keeps working).
 * - 'not-enough-history' → "Not enough price history yet" (fewer
 *   than 5 recorded prices — same threshold as Buy vs Wait,
 *   Section 20 §12 #46).
 * - backtest with zero trials → "Not enough history to backtest yet".
 *
 * Section 20, §12 #84 — the card labels the "current" price with
 * its real age: the API's lastRecordedAt is rendered as "last
 * recorded $X (N days ago)" when stale, never as a current price.
 *
 * Wave-2 wiring: render <ForecastCard productIdOrSlug={slug} /> in
 * the product detail page (product-detail-client.tsx is owned by
 * another workstream — do NOT wire it here).
 */

'use client';

import { useEffect, useState } from 'react';
import { TrendingDown, TrendingUp, Minus, LineChart } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { formatForecastBasis } from '@/lib/forecast';
import { cn } from '@/lib/utils';

interface HorizonForecast {
  horizonDays: number;
  central: number;
  low: number;
  high: number;
  confidencePct: number;
  direction: 'down' | 'up' | 'flat';
  pointsUsed: number;
  historyDays: number;
}

interface BacktestSummary {
  horizonDays: number;
  trials: number;
  hits: number;
  accuracyPct: number | null;
  status: 'ok' | 'not-enough-history';
  note: string;
}

interface ForecastResponse {
  product: { id: string; name: string; slug: string; category: string | null } | null;
  currentPrice: number | null;
  /** ISO timestamp of the latest recorded price point (null when none). */
  lastRecordedAt: string | null;
  historyPoints: number;
  historyDays: number;
  status: 'ok' | 'not-enough-history';
  forecasts: HorizonForecast[];
  backtest: BacktestSummary;
  method: string;
  note: string;
}

interface ForecastCardProps {
  productIdOrSlug: string;
  className?: string;
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function ForecastCard({ productIdOrSlug, className }: ForecastCardProps) {
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    fetch(`/api/v1/forecast/${encodeURIComponent(productIdOrSlug)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { success?: boolean; data?: ForecastResponse } | null) => {
        if (cancelled) return;
        if (json?.success && json.data) {
          setData(json.data);
        } else {
          setFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [productIdOrSlug]);

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LineChart className="h-5 w-5" /> Price forecast
          </CardTitle>
        </CardHeader>
        <CardContent>
          <LoadingSpinner />
        </CardContent>
      </Card>
    );
  }

  if (failed || !data) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LineChart className="h-5 w-5" /> Price forecast
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            title="Forecast unavailable right now"
            description="The forecast could not be loaded. The rest of the page is unaffected — please try again later."
          />
        </CardContent>
      </Card>
    );
  }

  if (data.status === 'not-enough-history' || data.forecasts.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LineChart className="h-5 w-5" /> Price forecast
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            title="Not enough price history yet"
            description={`Only ${data.historyPoints} recorded price${data.historyPoints === 1 ? '' : 's'} so far — at least 5 recorded prices are needed before any forecast can be made. Check back as history accrues.`}
          />
          <p className="mt-4 text-xs text-muted-foreground">{data.method}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LineChart className="h-5 w-5" /> Price forecast
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Probabilistic ranges from {data.historyPoints} recorded prices over{' '}
          {data.historyDays} days — not a guarantee of a future price.
        </p>
        {data.currentPrice !== null && (
          <p className="text-sm text-muted-foreground">
            {(() => {
              // Section 20, §12 #84 — the "current" price is the
              // last RECORDED price; label it with its real age.
              const at = data.lastRecordedAt
                ? new Date(data.lastRecordedAt).getTime()
                : NaN;
              if (!Number.isFinite(at)) {
                return `Last recorded price: ${money(data.currentPrice!)} (check date unknown — may be out of date).`;
              }
              const ageDays = Math.max(
                0,
                Math.floor((Date.now() - at) / 86_400_000)
              );
              return ageDays > 7
                ? `Last recorded price: ${money(data.currentPrice!)} (${ageDays} days ago — may be out of date).`
                : `Last recorded price: ${money(data.currentPrice!)}.`;
            })()}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {data.forecasts.map((f) => (
          <div
            key={f.horizonDays}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
          >
            <div className="flex items-center gap-2">
              {f.direction === 'down' ? (
                <TrendingDown className="h-4 w-4 text-green-600" />
              ) : f.direction === 'up' ? (
                <TrendingUp className="h-4 w-4 text-red-600" />
              ) : (
                <Minus className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="font-medium">In {f.horizonDays} days</span>
              <Badge
                variant="outline"
                className={cn(
                  f.direction === 'down' && 'border-green-600 text-green-700',
                  f.direction === 'up' && 'border-red-600 text-red-700'
                )}
              >
                {f.direction === 'down'
                  ? 'Likely down'
                  : f.direction === 'up'
                    ? 'Likely up'
                    : 'Likely flat'}
              </Badge>
            </div>
            <div className="text-right">
              <div className="font-semibold">
                {money(f.low)} – {money(f.high)}
              </div>
              {/* Section 16, item 11: the point count and
                  confidence band behind this range — "based on 4
                  points, low confidence" — not a bare %. */}
              <div className="text-xs text-muted-foreground">
                {formatForecastBasis(f.pointsUsed, f.confidencePct)} · centre{' '}
                {money(f.central)}
              </div>
            </div>
          </div>
        ))}
        <div className="rounded-lg bg-muted p-3 text-sm">
          <span className="font-medium">Backtest (30-day forecasts): </span>
          {data.backtest.status === 'ok' && data.backtest.accuracyPct !== null ? (
            <span>
              {data.backtest.hits} of {data.backtest.trials} past forecasts landed
              inside their range — {data.backtest.accuracyPct}% accuracy on this
              product&apos;s own recorded history.
            </span>
          ) : (
            <span>
              Not enough history to backtest yet — no past forecast has a recorded
              price at its horizon date.
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{data.method}</p>
      </CardContent>
    </Card>
  );
}
