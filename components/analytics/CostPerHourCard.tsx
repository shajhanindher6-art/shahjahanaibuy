'use client';

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  computeCostPerHour,
  computeDailyCost,
  formatCostPerHour,
  labelForCostPerHour,
  monthlySavingTarget,
} from '@/lib/analytics/costPerHour';
import { ownershipStorageKey } from '@/services/total-ownership';

/**
 * True-Cost Per Hour Card (Option 16, Step 3).
 *
 * Hourly cost from the TOTAL ownership cost — the real recorded price
 * plus the shopper's own accessories / warranty / maintenance extras
 * already saved on this device by the Total Ownership calculator
 * (same localStorage key). When no extras were saved, the total is
 * just the recorded price, and the card says so.
 *
 * Fixed 3-year horizon per the spec formula; daily cost uses the
 * product's own lifespan when known. No price → honest empty state.
 */

function readSavedExtras(slug: string): number {
  if (typeof localStorage === 'undefined') return 0;
  try {
    const raw = localStorage.getItem(ownershipStorageKey(slug));
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const read = (value: unknown): number =>
      typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
    return read(parsed.accessories) + read(parsed.warranty) + read(parsed.maintenance);
  } catch {
    return 0;
  }
}

export function CostPerHourCard({
  slug,
  priceUsd,
  dailyHours,
  lifespanYears,
}: {
  slug: string;
  priceUsd: number | null;
  dailyHours?: number | null;
  lifespanYears?: number | null;
}) {
  const [extrasUsd, setExtrasUsd] = useState(0);

  useEffect(() => {
    setExtrasUsd(readSavedExtras(slug));
  }, [slug]);

  const hours = dailyHours ?? 6;
  const totalUsd =
    priceUsd !== null && priceUsd !== undefined && Number.isFinite(priceUsd) && priceUsd > 0
      ? priceUsd + extrasUsd
      : null;
  const result = computeCostPerHour({ totalOwnershipUsd: totalUsd, dailyHours: hours });
  const daily = computeDailyCost({ priceUsd, lifespanYears: lifespanYears ?? 3 });
  const saving12 = monthlySavingTarget({ priceUsd, months: 12 });

  if (totalUsd === null || result.status !== 'ok') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">True Cost Per Hour</CardTitle>
          <CardDescription>What each active hour of use really costs</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No recorded price for this product, so the hourly cost can&apos;t be calculated.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-5 w-5 text-muted-foreground" />
          True Cost Per Hour
        </CardTitle>
        <CardDescription>What each active hour of use really costs</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-2xl font-bold">{formatCostPerHour(result.costPerHourUsd)}</p>
        <p className="text-sm font-medium text-emerald-700">
          {labelForCostPerHour(result.costPerHourUsd)}
        </p>
        <p className="text-sm text-muted-foreground">
          Based on a total ownership cost of ${totalUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          {extrasUsd > 0
            ? ` (price + $${extrasUsd.toLocaleString()} of your own extras saved on this device)`
            : ' (recorded price; add your own extras in the Total Ownership calculator)'}
          , spread over 3 years at {hours} active hours a day.
        </p>
        {daily !== null && (
          <p className="text-sm text-muted-foreground">
            That&apos;s about ${daily.toFixed(2)} per day
            {lifespanYears ? ` over its typical ${lifespanYears}-year lifespan` : ' over 3 years'}.
          </p>
        )}
        {saving12 !== null && (
          <p className="text-sm text-muted-foreground">
            Save ${saving12.toFixed(2)} a month to afford it in 12 months.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
