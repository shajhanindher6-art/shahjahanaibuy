'use client';

import { useEffect, useState } from 'react';
import { ShieldAlert, CheckCircle2, Clock } from 'lucide-react';
import { detectFakeSale, type FakeSalePoint } from '@/services/fake-sale';
import { deriveLowest90d, NINETY_DAY_WINDOW_DAYS } from '@/services/ninety-day';
import { cn } from '@/lib/utils';

/**
 * 90-Day Anti-Trap Check (Option 18).
 *
 * Runs TWO pure checks over the product's REAL recorded price_history
 * points (same endpoint the price history graph uses, all retailers
 * combined):
 *  - the derived 90-day lowest price — "History data pending" until
 *    the recorded history actually covers 90 days (today it is only
 *    ~7 days, so every product is pending);
 *  - Fake Deal 90 — the existing fake-sale detector with a 90-day
 *    window (same thresholds: rise >= 10% + drop + sale price not
 *    below the pre-rise price, pattern-only wording, never a
 *    scam/fraud accusation).
 *
 * Renders nothing while loading or on fetch failure; "pending"
 * renders a muted card, never a clean bill. The existing 30-day
 * Trust Section cards are untouched — this is the 90-day view.
 */
export function FakeDeal90Card({ slug }: { slug: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [points, setPoints] = useState<FakeSalePoint[]>([]);

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
        const pts = history
          .map((h) => ({ price: Number(h.price), recordedAt: h.recordedAt }))
          .filter((h) => Number.isFinite(h.price) && h.recordedAt);
        if (!cancelled) {
          setPoints(pts);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (failed || !loaded) return null;

  const lowest90 = deriveLowest90d(points);
  const fake90 = detectFakeSale(points, NINETY_DAY_WINDOW_DAYS);
  const pending = lowest90.status === 'pending';

  if (pending) {
    return (
      <div className="rounded-xl border p-4">
        <div className="flex items-start gap-3">
          <Clock className="mt-0.5 h-6 w-6 flex-shrink-0 text-muted-foreground" />
          <div>
            <h4 className="font-bold">History data pending — 90-day check</h4>
            <p className="mt-1 text-sm text-muted-foreground">
              {lowest90.reason} The 90-day lowest price and the 90-day fake-deal
              check need a full 90 days of recorded prices before they can say
              anything.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const Icon = fake90.alert ? ShieldAlert : CheckCircle2;
  const title = fake90.alert
    ? 'Fake-discount pattern detected (90 days)'
    : 'No fake-discount pattern in the last 90 days';

  return (
    <div
      className={cn(
        'rounded-xl border p-4',
        fake90.alert
          ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/50'
          : 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/50'
      )}
    >
      <div className="flex items-start gap-3">
        <Icon
          className={cn(
            'mt-0.5 h-6 w-6 flex-shrink-0',
            fake90.alert ? 'text-red-500' : 'text-emerald-500'
          )}
        />
        <div className="flex-1">
          <h4 className="font-bold">{title}</h4>
          <p className="mt-1 text-sm text-muted-foreground">
            Lowest price in the last {NINETY_DAY_WINDOW_DAYS} days:{' '}
            <span className="font-medium text-foreground">
              ${lowest90.lowest?.toFixed(2)}
            </span>{' '}
            across {lowest90.pointsInWindow} recorded prices (span{' '}
            {lowest90.spanDays} days).
          </p>
          {fake90.explanation && (
            <p className="mt-1 text-sm text-muted-foreground">
              {fake90.explanation}
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Pattern flag only — this describes the recorded prices, not any
            seller&apos;s intent.
          </p>
        </div>
      </div>
    </div>
  );
}
