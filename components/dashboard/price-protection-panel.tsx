/**
 * Price-protection panel (Section 6, Item 7 — trimmed).
 *
 * STANDALONE — not mounted anywhere yet. A wave-2 integrator mounts
 * it on the dashboard and passes the watches from
 * GET /api/v1/price-protection (eligibility is derived on view by
 * the API from recorded price_history; this panel never stores or
 * invents eligibility).
 *
 * A claim is a user-submitted record for review — the panel says so
 * on every render, and the copy after submitting says: "Claim
 * recorded for review — no refund is guaranteed". No refund is
 * promised and no refund amount is ever shown.
 */

'use client';

import { ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Price } from '@/components/region/price';
import type { ProtectionEligibility, ProtectionWatchView } from '@/lib/price-protection';

const ELIGIBILITY_LABEL: Record<ProtectionEligibility, string> = {
  eligible: 'Eligible — price dropped in window',
  not_eligible: 'No drop yet — window still open',
  no_data: 'Not enough data',
  expired: 'Window expired — no drop recorded',
};

const ELIGIBILITY_VARIANT: Record<
  ProtectionEligibility,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  eligible: 'default',
  not_eligible: 'secondary',
  no_data: 'outline',
  expired: 'destructive',
};

export function PriceProtectionPanel({
  watches,
  loading = false,
  onSubmitClaim,
}: {
  /** Rows from GET /api/v1/price-protection (eligibility derived). */
  watches: ProtectionWatchView[];
  loading?: boolean;
  onSubmitClaim?: (id: string) => void;
}) {
  return (
    <section id="price-protection" className="animate-fade-in motion-reduce:animate-none">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
        <ShieldCheck className="h-5 w-5 text-emerald-600" /> Price-drop protection
      </h2>
      <p className="-mt-2 mb-4 text-xs text-muted-foreground">
        Watches on your past purchases. Eligibility is derived from recorded price history — a
        claim is recorded for review, no refund is guaranteed.
      </p>
      {loading ? (
        <div className="glass-card h-32 animate-shimmer" />
      ) : watches.length === 0 ? (
        <div className="glass-card p-6 text-center">
          <p className="text-sm font-medium">No protection watches yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add a purchase to your Receipt Vault with a recorded amount, then watch it here for a
            price drop inside its protection window.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {watches.map((watch) => {
            const claimed = watch.status === 'claim_submitted';
            return (
              <div
                key={watch.id}
                className="glass-card flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {watch.productName ?? 'Product'}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Purchased for{' '}
                    {watch.purchase_price !== null ? (
                      <Price usd={Number(watch.purchase_price)} />
                    ) : (
                      'amount not recorded'
                    )}
                    {watch.windowEndDate
                      ? ` · Window ends ${new Date(watch.windowEndDate).toLocaleDateString()}`
                      : ''}
                    {watch.lowestInWindowPriceUsd !== null
                      ? ` · Lowest in window: $${watch.lowestInWindowPriceUsd.toFixed(2)}`
                      : ''}
                  </p>
                  <div className="mt-2">
                    <Badge variant={ELIGIBILITY_VARIANT[watch.eligibility]}>
                      {ELIGIBILITY_LABEL[watch.eligibility]}
                    </Badge>
                  </div>
                  {claimed && (
                    <p className="mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                      Claim recorded for review — no refund is guaranteed.
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {watch.eligibility === 'eligible' && !claimed && onSubmitClaim && (
                    <Button onClick={() => onSubmitClaim(watch.id)}>Submit claim</Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
