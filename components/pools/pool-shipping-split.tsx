'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { POOL_SHIPPING_NOTE, splitShippingEstimate } from '@/services/smartpool';
import { formatUsd } from '@/lib/region';

/**
 * Shared international shipping split (Option 11, Phase 3).
 * For pools in the same region/city, shows each member's share of the
 * estimated international shipping, split evenly across the pool's
 * REAL member count.
 *
 * The shipping total comes ONLY from an estimate the pool creator
 * supplied (stored on the pool) — the same user-entered convention as
 * the Option 11 landed-cost calculator, where shipping is 0 when
 * unknown. No shipping rate, cost, or carrier is ever invented: when
 * no estimate exists, this renders the honest empty state ("No
 * shipping estimate available") and offers a local preview input so
 * the viewer can try their own estimate — that preview is labelled as
 * the viewer's own number, never as a real quote.
 */
export function PoolShippingSplit({
  shippingEstimateUsd,
  memberCount,
  regionCode,
  city,
}: {
  /** Creator-supplied shipping estimate in USD, or null when none. */
  shippingEstimateUsd: number | null;
  /** Real member count of the pool. */
  memberCount: number;
  regionCode: string;
  city: string | null;
}) {
  const [previewEstimate, setPreviewEstimate] = useState<number>(0);

  const stored = splitShippingEstimate(shippingEstimateUsd, memberCount);
  // A viewer-entered preview is only used when the pool has no stored
  // estimate — a stored estimate is the pool's shared number.
  const preview =
    stored === null ? splitShippingEstimate(previewEstimate, memberCount) : null;
  const split = stored ?? preview;
  const usingPreview = stored === null && preview !== null;


  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-sm font-medium">
        Shared international shipping — {city ? `${city}, ${regionCode}` : regionCode}
      </p>
      {split === null && memberCount < 1 && (
        <p className="text-sm text-muted-foreground">
          No members yet — a per-member share can&apos;t be computed until someone joins.
        </p>
      )}
      {split === null && memberCount >= 1 && (
        <>
          <p className="text-sm text-muted-foreground">
            No shipping estimate available for this pool yet.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="pool-shipping-preview">
              Preview with your own shipping estimate (USD, optional)
            </Label>
            <Input
              id="pool-shipping-preview"
              type="number"
              min={0}
              step="0.01"
              value={Number.isFinite(previewEstimate) ? previewEstimate : 0}
              onChange={(e) => setPreviewEstimate(Math.max(0, Number(e.target.value) || 0))}
            />
            <p className="text-xs text-muted-foreground">
              This preview uses only the number you enter here — it is not a carrier quote and
              is not saved to the pool.
            </p>
          </div>
        </>
      )}
      {split !== null && (
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between">
            <dt>Estimated total shipping{usingPreview ? ' (your preview estimate)' : ''}</dt>
            <dd>{formatUsd(split.totalUsd)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Members sharing it</dt>
            <dd>{split.members}</dd>
          </div>
          <div className="flex justify-between border-t pt-1 font-semibold">
            <dt>Your share (estimate)</dt>
            <dd>{formatUsd(split.perMemberUsd)} per member</dd>
          </div>
        </dl>
      )}
      <p className="text-xs text-muted-foreground">{POOL_SHIPPING_NOTE}</p>
    </div>
  );
}
