'use client';

import { useEffect, useState } from 'react';
import { FlaskConical, Bell } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { simulateDropWindow, type DropWindowSimulation } from '@/services/drop-window';
import { PriceAlertDialog } from '@/components/products/price-alert-dialog';

/**
 * Price Drop Window & Confidence Simulator (Option 10, Feature 2).
 * Extends the Option 7 Buy-vs-Wait engine: velocity comes ONLY from the
 * product's real recorded price_history points, confidence/seasonality
 * inherit the Buy-vs-Wait thin-data rules, and the whole section is
 * labeled SIMULATION. The "price lock" shortcut is an ALERT via the
 * existing alerts system — no price is ever locked with a retailer, and
 * no exact future price is ever stated as fact (ranges only).
 */
export function DropWindowSimulator({
  slug,
  productId,
  productName,
  cheapestPriceUsd,
}: {
  slug: string;
  productId: string;
  productName: string;
  cheapestPriceUsd: number | null;
}) {
  const [sim, setSim] = useState<DropWindowSimulation | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/v1/products/${slug}/prices?limit=100`, {
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error('prices request failed');
        const data = await res.json();
        const history = (data?.data?.history ?? []) as Array<{ price: number; recordedAt: string }>;
        const points = history
          .map((h) => ({ price: Number(h.price), recordedAt: h.recordedAt }))
          .filter((h) => Number.isFinite(h.price) && h.recordedAt);
        if (!cancelled) setSim(simulateDropWindow(points));
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="h-5 w-5 text-violet-600" /> Price drop window simulator
        </CardTitle>
        <CardDescription>
          Simulated — not a forecast or a guarantee. Built only from this product&apos;s recorded
          price history.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {failed && (
          <p className="text-sm text-muted-foreground">
            Simulation could not be loaded. Try again later.
          </p>
        )}
        {!failed && !sim && (
          <p className="text-sm text-muted-foreground">Running simulation…</p>
        )}
        {!failed && sim && sim.status === 'not_enough_data' && (
          <p className="text-sm text-muted-foreground">{sim.reason}</p>
        )}
        {!failed && sim && sim.status === 'no_drops' && (
          <p className="text-sm text-muted-foreground">{sim.reason}</p>
        )}
        {!failed && sim && sim.status === 'simulated' && (
          <>
            <p className="text-sm">{sim.reason}</p>
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="secondary">
                Confidence {sim.confidence}%{sim.lowConfidence ? ' (Low)' : ''}
              </Badge>
              <Badge variant="secondary">
                {sim.dropCount} recorded drop{sim.dropCount === 1 ? '' : 's'}
              </Badge>
              <Badge variant="secondary">
                Avg drop {sim.avgDropPct}%
              </Badge>
              <Badge variant="secondary">
                {sim.seasonalSupported
                  ? 'Seasonal analysis supported'
                  : 'Not enough history for seasonal analysis'}
              </Badge>
            </div>
            {sim.windowDays && (
              <p className="text-sm">
                Simulated window: a drop of ~{sim.avgDropPct}% could fall within{' '}
                <strong>
                  {sim.windowDays[0]}–{sim.windowDays[1]} days
                </strong>{' '}
                if past velocity continued.
              </p>
            )}
            {!sim.windowDays && (
              <p className="text-sm text-muted-foreground">
                No day-window is claimed: only one drop has been recorded, so the interval between
                drops is unknown.
              </p>
            )}
            {sim.simulatedTargetRangeUsd && (
              <p className="text-sm">
                Simulated target range:{' '}
                <strong>
                  ${sim.simulatedTargetRangeUsd[0].toFixed(2)} – $
                  {sim.simulatedTargetRangeUsd[1].toFixed(2)}
                </strong>{' '}
                (a range, not a predicted price).
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <PriceAlertDialog
                productId={productId}
                productName={productName}
                currentPrice={cheapestPriceUsd}
                initialTargetPrice={sim.simulatedTargetRangeUsd ? sim.simulatedTargetRangeUsd[1] : null}
                triggerLabel="Set simulated price alert"
              />
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Bell className="h-3 w-3" />
                This sets an alert, not a price lock — no price is locked with any retailer.
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
