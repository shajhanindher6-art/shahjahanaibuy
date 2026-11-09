'use client';

import { useState } from 'react';
import { Scale, Zap, Package } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  computeAnnualCost,
  computeAnnualEnergyKwh,
  DAILY_USE_HOURS,
  heavyItemNote,
  type PhysicalAttributesData,
} from '@/services/physical-attributes';

/**
 * Weight & Power Card (Option 18).
 *
 * Shows RECORDED physical attributes only (item weight, power draw)
 * plus two derived figures that are labeled as what they are:
 *  - annual energy (kWh/year) at a stated 8h/day use assumption;
 *  - annual cost, ONLY from a tariff the shopper types in here —
 *    the input is local state, never sent or stored, and no tariff
 *    is ever assumed (no tariff table exists).
 * A heavy item (>= 10 kg) gets a shipping note, never a shipping
 * cost estimate — no shipping-rate data exists.
 *
 * No recorded data → honest "Not recorded yet" state, never a
 * fabricated weight or wattage.
 */
export function WeightPowerCard({
  physical,
  title,
}: {
  physical: PhysicalAttributesData | null | undefined;
  title?: string;
}) {
  const [tariff, setTariff] = useState('');

  const data: PhysicalAttributesData = physical ?? { itemWeightKg: null, powerDrawWatts: null };
  const recorded = data.itemWeightKg !== null || data.powerDrawWatts !== null;
  const kwh = computeAnnualEnergyKwh(data.powerDrawWatts);
  const note = heavyItemNote(data.itemWeightKg);
  const tariffNum = tariff.trim() === '' ? null : Number(tariff);
  const annualCost = computeAnnualCost(data.powerDrawWatts, tariffNum);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Scale className="h-5 w-5 text-slate-500" />
          Weight &amp; Power{title ? ` — ${title}` : ''}
        </CardTitle>
        <CardDescription>
          Recorded item weight &amp; power draw (recorded data only)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!recorded ? (
          <p className="text-sm text-muted-foreground">
            Weight and power draw not recorded for this product yet. Nothing
            here is estimated.
          </p>
        ) : (
          <>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="flex items-center gap-1.5 text-muted-foreground">
                  <Package className="h-4 w-4" /> Item weight
                </dt>
                <dd className="font-medium">
                  {data.itemWeightKg !== null ? `${data.itemWeightKg} kg` : 'Not recorded'}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="flex items-center gap-1.5 text-muted-foreground">
                  <Zap className="h-4 w-4" /> Power draw
                </dt>
                <dd className="font-medium">
                  {data.powerDrawWatts !== null ? `${data.powerDrawWatts} W` : 'Not recorded'}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Annual energy use</dt>
                <dd className="font-medium">
                  {kwh !== null ? `${kwh} kWh/year` : '—'}
                </dd>
              </div>
            </dl>
            {kwh !== null && (
              <p className="text-xs text-muted-foreground">
                Estimate at {DAILY_USE_HOURS} hours/day use — not a measured
                figure.
              </p>
            )}
            {note && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                {note}
              </p>
            )}
            {kwh !== null && (
              <div className="space-y-1.5 border-t pt-3">
                <label
                  htmlFor="power-tariff"
                  className="block text-sm font-medium"
                >
                  Your electricity tariff ($/kWh) — optional
                </label>
                <input
                  id="power-tariff"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={tariff}
                  onChange={(e) => setTariff(e.target.value)}
                  placeholder="e.g. 0.15"
                  className="w-32 rounded-md border px-2 py-1 text-sm"
                />
                <p className="text-sm text-muted-foreground">
                  {annualCost !== null
                    ? `Estimated running cost: $${annualCost.toFixed(2)}/year at your tariff.`
                    : 'Enter your tariff to see an estimated yearly running cost.'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Your tariff is entered here only — it is never sent or
                  stored.
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
