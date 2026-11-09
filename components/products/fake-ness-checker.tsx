'use client';

import { useEffect, useState } from 'react';
import { ShieldAlert, TrendingUp, CheckCircle2, Clock } from 'lucide-react';
import { checkPriceInflation, type InflationCheckResult } from '@/services/inflation-check';
import { cn } from '@/lib/utils';

/**
 * Deal Fake-ness & Inflation Checker — standalone verdict card.
 *
 * Runs the pure checkPriceInflation engine over the product's REAL
 * recorded price_history points (same endpoint the price history graph
 * uses). Two pattern flags:
 *  - fake-discount pattern (rise + drop, discount only vs the raised
 *    price), delegated to the existing fake-sale detector;
 *  - sustained inflation (slow upward creep, still at/near the max),
 *    a signal the fake-sale detector does not cover.
 *
 * Verdict wording is a PATTERN flag only — never a scam/fraud
 * accusation. Renders nothing while loading or on fetch failure;
 * "not enough history" renders a muted card, never a clean bill.
 */
export function FakeNessChecker({ slug }: { slug: string }) {
  const [result, setResult] = useState<InflationCheckResult | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
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
        const points = history
          .map((h) => ({ price: Number(h.price), recordedAt: h.recordedAt }))
          .filter((h) => Number.isFinite(h.price) && h.recordedAt);
        if (!cancelled) setResult(checkPriceInflation(points));
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (failed || !result) return null;

  if (result.verdict === 'insufficient') {
    return (
      <div className="rounded-xl border p-4">
        <div className="flex items-start gap-3">
          <Clock className="mt-0.5 h-6 w-6 flex-shrink-0 text-slate-400" />
          <div>
            <h4 className="font-bold">Not enough history to check</h4>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{result.reason}</p>
          </div>
        </div>
      </div>
    );
  }

  const isFake = result.verdict === 'fake_discount_pattern';
  const isInflated = result.verdict === 'inflated';
  const Icon = isFake ? ShieldAlert : isInflated ? TrendingUp : CheckCircle2;
  const title = isFake
    ? 'Fake-discount pattern detected'
    : isInflated
      ? 'Sustained price inflation'
      : 'No fake-discount or inflation pattern';
  const pct = (v: number | null) =>
    v === null ? '—' : `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;

  return (
    <div
      className={cn(
        'rounded-xl border p-4',
        isFake
          ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/50'
          : isInflated
            ? 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/50'
            : 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/50'
      )}
    >
      <div className="flex items-start gap-3">
        <Icon
          className={cn(
            'mt-0.5 h-6 w-6 flex-shrink-0',
            isFake ? 'text-red-500' : isInflated ? 'text-amber-500' : 'text-emerald-500'
          )}
        />
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-bold">{title}</h4>
            {result.risePct !== null && (
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Rise {pct(result.risePct)}
                {result.dropPct !== null && result.dropPct > 0
                  ? ` · Drop ${pct(-result.dropPct)}`
                  : ''}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{result.reason}</p>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Based on {result.pointCount} recorded price
            {result.pointCount === 1 ? '' : 's'} over the last 30 days
            {result.spanDays > 0 ? ` (span ${result.spanDays} days)` : ''}. Pattern
            flag only — this describes the recorded prices, not any seller&apos;s
            intent.
          </p>
        </div>
      </div>
    </div>
  );
}
