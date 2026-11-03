'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Price } from '@/components/region/price';
import { PriceAlertDialog } from '@/components/products/price-alert-dialog';
import {
  analyzeNegotiationGap,
  buildNegotiationDraft,
  type PricePoint,
} from '@/services/negotiation';

/**
 * AI Price Negotiator — gap analysis + message draft ONLY.
 *
 * HONESTY, enforced in the UI:
 * - SmartBuy CANNOT negotiate with retailers directly and has no
 *   retailer partnership. The header says so on every render.
 * - No discount is ever claimed as negotiated, no "unlisted" code is
 *   ever shown, and no hidden price is ever mentioned. The draft is
 *   a message the USER sends to the seller themselves.
 * - The only automation is the gap math, the copyable draft, and a
 *   shortcut to the existing price-alert dialog at the target price.
 * - Gap numbers come from the real cheapest merchant price and the
 *   product's REAL recorded price_history points. A target below
 *   every recorded price is flagged as such, not dressed up.
 */
export function PriceNegotiator({
  slug,
  productId,
  productName,
  cheapestPriceUsd,
}: {
  slug: string;
  productId: string;
  productName: string;
  /** Cheapest current merchant price (USD), or null when unknown. */
  cheapestPriceUsd: number | null;
}) {
  const [history, setHistory] = useState<PricePoint[]>([]);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/v1/products/${slug}/prices?limit=100`, {
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error('prices request failed');
        const data = await res.json();
        const points = ((data?.data?.history ?? []) as Array<{ price: number; recordedAt: string }>)
          .map((h) => ({ price: Number(h.price), recordedAt: h.recordedAt }))
          .filter((h) => Number.isFinite(h.price) && h.recordedAt);
        if (!cancelled) setHistory(points);
      } catch {
        if (!cancelled) setHistoryFailed(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const targetNum = useMemo(() => {
    const n = Number(target);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [target]);

  const gap = useMemo(
    () => (targetNum !== null ? analyzeNegotiationGap(cheapestPriceUsd, history, targetNum) : null),
    [targetNum, cheapestPriceUsd, history]
  );

  const draft = useMemo(
    () => (gap ? buildNegotiationDraft({ productName, gap, reason }) : null),
    [gap, productName, reason]
  );

  async function copyDraft() {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft);
    } catch {
      // Clipboard blocked: the draft is still visible for manual copying.
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle className="text-base">Price negotiator — make your case</CardTitle>
        <CardDescription>
          SmartBuy cannot negotiate with retailers directly and has no retailer partnership, so no
          discount is negotiated here. Instead, enter the price you&apos;d pay: we&apos;ll show how it
          compares to real recorded prices and draft a polite message you can send to the seller
          yourself — or set a price alert at that target and wait for the price to come to you.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="neg-target">Your target price (USD)</Label>
            <Input
              id="neg-target"
              type="number"
              min={0}
              step={0.01}
              placeholder="e.g. 899"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="neg-reason">Reason (optional, your own words)</Label>
            <Input
              id="neg-reason"
              placeholder="e.g. buying for a student budget"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>

        {target !== '' && targetNum === null && (
          <p className="text-sm text-muted-foreground">
            Enter a valid target price above $0 to see the gap analysis.
          </p>
        )}

        {gap && (
          <div className="space-y-2 rounded-lg border p-3 text-sm">
            <p>
              Cheapest today:{' '}
              {gap.currentCheapestUsd !== null ? (
                <Price usd={gap.currentCheapestUsd} showOriginal={false} />
              ) : (
                'unknown'
              )}
              {gap.lowestRecordedUsd !== null && (
                <>
                  {' · '}Lowest recorded:{' '}
                  <Price usd={gap.lowestRecordedUsd} showOriginal={false} />
                </>
              )}
              {gap.averageRecordedUsd !== null && (
                <>
                  {' · '}Average recorded:{' '}
                  <Price usd={gap.averageRecordedUsd} showOriginal={false} />
                </>
              )}
              <span className="text-muted-foreground"> ({gap.pointsUsed} recorded points)</span>
            </p>
            {gap.alreadyMet ? (
              <p className="font-medium text-green-600">
                Your target is already met — the cheapest listing is at or below it today.
              </p>
            ) : gap.gapVsCurrentUsd !== null ? (
              <p>
                Gap to today&apos;s cheapest price:{' '}
                <span className="font-medium">
                  <Price usd={Math.abs(gap.gapVsCurrentUsd)} showOriginal={false} />
                  {gap.gapVsCurrentPct !== null ? ` (${Math.abs(gap.gapVsCurrentPct)}% below)` : ''}
                </span>
              </p>
            ) : null}
            {gap.belowEveryRecordedPrice && (
              <p className="text-amber-700 dark:text-amber-400">
                Note: this target is below every price ever recorded for this product, so a seller
                is unlikely to accept it at retail — consider a target within the recorded range.
              </p>
            )}
            {historyFailed && (
              <p className="text-muted-foreground">
                Recorded price history could not be loaded, so the comparison uses today&apos;s price
                only.
              </p>
            )}
          </div>
        )}

        {gap && draft && (
          <div className="space-y-2">
            <Label>Message draft — copy and send it to the seller yourself</Label>
            <p className="rounded-lg border bg-slate-50 p-3 text-sm leading-relaxed dark:bg-slate-900">
              {draft}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={copyDraft}>
                {copied ? 'Copied!' : 'Copy message'}
              </Button>
              <PriceAlertDialog
                productId={productId}
                productName={productName}
                currentPrice={cheapestPriceUsd}
                initialTargetPrice={targetNum}
                triggerLabel={`Set alert at $${gap.targetUsd.toFixed(2)}`}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              No code is generated here and no outcome is promised — the alert watches the real
              price, and the message is yours to send.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
