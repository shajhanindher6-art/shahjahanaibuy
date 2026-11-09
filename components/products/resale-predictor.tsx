'use client';

import { useEffect, useState } from 'react';
import { Clock, Recycle } from 'lucide-react';
import { predictResaleValue, type ResalePrediction } from '@/services/resale-predictor';

/**
 * Trade-in / Resale Value Predictor — renders the deterministic projection
 * from the product's REAL recorded price_history points (same endpoint the
 * price history graph uses). There is no resale transaction data and no
 * measured category depreciation curve: the output is a straight-line
 * projection of the product's own recorded decline, labeled SIMULATED
 * on every render — never a resale quote, never a guarantee.
 */
export function ResalePredictor({
  slug,
  currentPriceUsd,
  recordedAnnualRate,
}: {
  slug: string;
  currentPriceUsd: number | null;
  /**
   * Recorded annual depreciation rate as a fraction (0–1, Option 19).
   * When present it OVERRIDES the decline derived from recorded
   * prices; when absent the projection derives from price history.
   */
  recordedAnnualRate?: number | null;
}) {
  const [prediction, setPrediction] = useState<ResalePrediction | null>(null);
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
        if (!cancelled) setPrediction(predictResaleValue(points, currentPriceUsd, recordedAnnualRate ?? null));
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [slug, currentPriceUsd, recordedAnnualRate]);

  // Loading or fetch failure: render nothing (never a fake projection).
  if (failed || !prediction) return null;

  if (prediction.status === 'insufficient') {
    return (
      <div className="rounded-xl border p-4">
        <div className="flex items-start gap-3">
          <Clock className="mt-0.5 h-6 w-6 flex-shrink-0 text-slate-400" />
          <div>
            <h4 className="font-bold">Resale value — not enough history yet</h4>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {prediction.reason}
            </p>
            {recordedAnnualRate === null || recordedAnnualRate === undefined ? (
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                No recorded annual depreciation rate yet — depreciation data
                is still accumulating.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border p-4">
      <div className="flex items-start gap-3">
        <Recycle className="mt-0.5 h-6 w-6 flex-shrink-0 text-emerald-500" />
        <div className="flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <h4 className="font-bold">Trade-in / Resale Value</h4>
            <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {prediction.retentionPct24}%
            </span>
            <span className="text-sm text-slate-600 dark:text-slate-400">
              of value retained after 24 months
            </span>
          </div>
          {prediction.projectedValueUsd24 !== null && currentPriceUsd !== null && (
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Projected value at 24 months: ${prediction.projectedValueUsd24.toFixed(2)} (from
              current ${currentPriceUsd.toFixed(2)})
            </p>
          )}
          {prediction.curve && (
            <table className="mt-3 w-full max-w-xs text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 dark:text-slate-400">
                  <th className="py-1 pr-2 font-medium">After</th>
                  <th className="py-1 font-medium">Value retained</th>
                </tr>
              </thead>
              <tbody>
                {prediction.curve.map((c) => (
                  <tr
                    key={c.month}
                    className="border-t border-slate-100 dark:border-slate-800"
                  >
                    <td className="py-1 pr-2 text-slate-600 dark:text-slate-400">
                      {c.month} months
                    </td>
                    <td className="py-1 font-medium">{c.retentionPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            {prediction.reason}
          </p>
          {prediction.source === 'recorded' && prediction.recordedAnnualRatePct !== null && (
            <p className="mt-1 text-sm font-medium text-slate-700 dark:text-slate-300">
              Recorded rate: {prediction.recordedAnnualRatePct}% per year —
              this overrides the decline derived from recorded prices.
            </p>
          )}
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Simulated — not a resale quote or guarantee.{' '}
            {prediction.source === 'recorded' ? (
              <>Based on the recorded annual depreciation rate.</>
            ) : (
              <>
                Based on {prediction.pointCount} recorded price point
                {prediction.pointCount === 1 ? '' : 's'} over{' '}
                {prediction.spanDays} days
                {prediction.monthlyDeclinePct !== null &&
                  `, declining about ${prediction.monthlyDeclinePct}% per month`}
                .
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
