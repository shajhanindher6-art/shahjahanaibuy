'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Price } from '@/components/region/price';
import { REGIONS } from '@/lib/region';
import {
  DEFAULT_DUTY_PCT,
  standardRateForCountry,
  manualRateNote,
} from '@/services/tax-estimator';
import { optimizeShipments } from '@/services/duty-optimizer';

/**
 * Cross-Border Customs & Duty Optimizer — compares the USER's own
 * split-shipment scenarios using the Option 7 tax estimator's rates.
 *
 * HONESTY, enforced in the UI:
 * - Headed "Estimate only — not a customs quote" on every render.
 * - De minimis is applied ONLY for the US ($800). Every other
 *   country shows "threshold unknown — no threshold benefit
 *   assumed" and gets no threshold benefit.
 * - The "cheapest" scenario is only the cheapest ESTIMATE among the
 *   scenarios entered — never a guaranteed saving.
 * - Compliance notes on every render: splitting can increase total
 *   shipping cost and delivery time, customs may aggregate related
 *   shipments, and this is a cost comparison, NOT advice to evade
 *   duties — comply with local customs rules.
 * - Split values are the order value divided evenly (a simplification
 *   the UI states); real shipments can be split unevenly.
 */
export function DutyOptimizer({
  priceUsd,
  defaultCountryCode,
}: {
  /** Default order value: the real cheapest merchant price (USD). */
  priceUsd: number;
  /** Visitor's country code from the region system. */
  defaultCountryCode: string;
}) {
  const [countryCode, setCountryCode] = useState(defaultCountryCode);
  const standard = standardRateForCountry(countryCode);
  const manualNote = manualRateNote(countryCode);
  const [orderValue, setOrderValue] = useState<number>(priceUsd);
  const [vatPct, setVatPct] = useState<number>(standard ? standard.ratePct : 0);
  const [dutyPct, setDutyPct] = useState<number>(DEFAULT_DUTY_PCT);
  const [shippingPer, setShippingPer] = useState<number>(0);
  const [splitInput, setSplitInput] = useState<string>('1, 2');

  // Same stale-fallback bug as the tax estimator (see there): region
  // detection lands after mount, so follow defaultCountryCode until
  // the visitor manually picks a country here; after that, their
  // choice wins and prop changes never clobber it.
  const userPickedCountry = useRef(false);
  useEffect(() => {
    if (!userPickedCountry.current && defaultCountryCode !== countryCode) {
      setCountryCode(defaultCountryCode);
      const next = standardRateForCountry(defaultCountryCode);
      setVatPct(next ? next.ratePct : 0);
    }
  }, [defaultCountryCode, countryCode]);

  function handleCountryChange(code: string) {
    userPickedCountry.current = true;
    setCountryCode(code);
    const next = standardRateForCountry(code);
    setVatPct(next ? next.ratePct : 0);
  }

  const counts = useMemo(() => {
    const parsed = splitInput
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= 10);
    const unique = [...new Set(parsed)].sort((a, b) => a - b);
    return unique.length > 0 ? unique : [1];
  }, [splitInput]);

  const result = useMemo(
    () =>
      optimizeShipments({
        orderValueUsd: orderValue,
        countryCode,
        dutyPct,
        vatPct,
        shippingPerShipmentUsd: shippingPer,
        shipmentCounts: counts,
      }),
    [orderValue, countryCode, dutyPct, vatPct, shippingPer, counts]
  );

  const countryName = REGIONS.find((r) => r.code === countryCode)?.name ?? countryCode;

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle className="text-base">Customs &amp; duty optimizer — single vs split shipments</CardTitle>
        <CardDescription>
          Estimate only — not a customs quote. This compares YOUR scenarios (one shipment vs
          splitting the order) using the same estimate rates as the tax estimator. The cheapest
          result is the cheapest estimate, not a guaranteed saving. Splitting can increase total
          shipping cost and delivery time, customs may aggregate related shipments, and this is a
          cost comparison — not advice to evade duties. Always comply with local customs rules.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="opt-country">Deliver to</Label>
            <Select value={countryCode} onValueChange={handleCountryChange}>
              <SelectTrigger id="opt-country">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REGIONS.map((r) => (
                  <SelectItem key={r.code} value={r.code}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {manualNote && <p className="text-xs text-muted-foreground">{manualNote}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="opt-value">Order value (USD)</Label>
            <Input
              id="opt-value"
              type="number"
              min={0}
              step={0.01}
              value={orderValue}
              onChange={(e) => setOrderValue(Number(e.target.value) || 0)}
            />
            <p className="text-xs text-muted-foreground">
              Defaults to this product&apos;s cheapest price; edit it for a full cart.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="opt-duty">Import duty % (adjustable)</Label>
            <Input
              id="opt-duty"
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={dutyPct}
              onChange={(e) => setDutyPct(Number(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="opt-vat">Local tax % (editable)</Label>
            <Input
              id="opt-vat"
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={vatPct}
              onChange={(e) => setVatPct(Number(e.target.value) || 0)}
            />
            {standard && (
              <p className="text-xs text-muted-foreground">
                Standard rate for {countryName}: {standard.label} {standard.ratePct}%.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="opt-ship">Shipping per shipment (USD)</Label>
            <Input
              id="opt-ship"
              type="number"
              min={0}
              step={0.01}
              value={shippingPer}
              onChange={(e) => setShippingPer(Number(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="opt-split">Shipment counts to compare (comma-separated)</Label>
            <Input
              id="opt-split"
              placeholder="1, 2"
              value={splitInput}
              onChange={(e) => setSplitInput(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Each scenario splits the order value evenly across its shipments.
            </p>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          {result.thresholdUsd !== null ? (
            <>
              De minimis threshold for {countryName}: <Price usd={result.thresholdUsd} showOriginal={false} /> —
              a shipment under it is treated as duty- and tax-free in this estimate.
            </>
          ) : (
            <>
              De minimis threshold for {countryName}: unknown — no threshold benefit is assumed in
              any scenario below.
            </>
          )}
        </p>
        {/* (12) Same placeholder rule as the tax estimator: for
            manual-rate countries the 0% tax default is unentered, not
            real — the scenario totals below are then price + duty +
            shipping only, and must not read as computed real totals. */}
        {standard === null && vatPct === 0 && (
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
            Local tax is 0% here because no rate was entered yet — 0% is a placeholder, not your
            real rate. Enter your local rate above for real scenario totals.
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Scenario</th>
                <th className="py-2 pr-3 font-medium">Per shipment</th>
                <th className="py-2 pr-3 font-medium">Duty (est.)</th>
                <th className="py-2 pr-3 font-medium">Tax (est.)</th>
                <th className="py-2 pr-3 font-medium">Shipping</th>
                <th className="py-2 font-medium">Estimated total</th>
              </tr>
            </thead>
            <tbody>
              {result.scenarios.map((s, i) => (
                <tr key={s.shipments} className="border-b last:border-0">
                  <td className="py-2 pr-3">
                    {s.shipments} shipment{s.shipments !== 1 ? 's' : ''}
                    {result.cheapestIndex === i && (
                      <Badge variant="default" className="ml-2 text-xs">
                        Cheapest estimate
                      </Badge>
                    )}
                    {s.thresholdApplied && (
                      <Badge variant="secondary" className="ml-2 text-xs">
                        Threshold applied
                      </Badge>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <Price usd={s.valuePerShipmentUsd} showOriginal={false} />
                  </td>
                  <td className="py-2 pr-3">
                    <Price usd={s.dutyUsd} showOriginal={false} />
                  </td>
                  <td className="py-2 pr-3">
                    <Price usd={s.vatUsd} showOriginal={false} />
                  </td>
                  <td className="py-2 pr-3">
                    <Price usd={s.shippingUsd} showOriginal={false} />
                  </td>
                  <td className="py-2 font-medium">
                    <Price usd={s.totalUsd} showOriginal={false} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          All figures are estimates from your inputs and the standard rates above. Real duties,
          taxes, and shipping depend on the carrier, HS classification, and customs — confirm
          before ordering.
        </p>
      </CardContent>
    </Card>
  );
}
