'use client';

import { useMemo, useState } from 'react';
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
import { Price } from '@/components/region/price';
import { REGIONS } from '@/lib/region';
import {
  DEFAULT_DUTY_PCT,
  estimateLandingPrice,
  manualRateNote,
  standardRateForCountry,
} from '@/services/tax-estimator';

/**
 * Smart Local Tax & Import Duty Estimator.
 *
 * HONESTY, enforced in the UI:
 * - Headed "Estimate only — not a customs quote" on every render.
 * - Every line is labeled as an estimate; the total is NEVER presented
 *   as the retailer's checkout total.
 * - VAT rates come from the documented standard-rate table (editable);
 *   countries without a single rate (US, CA, and all unlisted ones)
 *   ask the user to enter their local rate instead of a guessed one.
 * - Duty is a user-adjustable % with a documented placeholder default
 *   (10%) — there is no per-country/per-category duty schedule here.
 * - Shipping is user-entered (0 when unknown); no shipping cost is
 *   ever invented.
 */
export function TaxEstimator({
  priceUsd,
  defaultCountryCode,
}: {
  /** Cheapest in-stock merchant price in USD (a real recorded price). */
  priceUsd: number;
  /** Visitor's country code from the region system. */
  defaultCountryCode: string;
}) {
  const [countryCode, setCountryCode] = useState(defaultCountryCode);
  const standard = standardRateForCountry(countryCode);
  const manualNote = manualRateNote(countryCode);
  const [vatPct, setVatPct] = useState<number>(standard ? standard.ratePct : 0);
  const [dutyPct, setDutyPct] = useState<number>(DEFAULT_DUTY_PCT);
  const [shipping, setShipping] = useState<number>(0);

  // When the country changes, refill the VAT rate from the table (or
  // clear it for manual-rate countries) — the user can still edit it.
  function handleCountryChange(code: string) {
    setCountryCode(code);
    const next = standardRateForCountry(code);
    setVatPct(next ? next.ratePct : 0);
  }

  const estimate = useMemo(
    () =>
      estimateLandingPrice({
        priceUsd,
        dutyPct,
        vatPct,
        shippingUsd: shipping,
      }),
    [priceUsd, dutyPct, vatPct, shipping]
  );

  const countryName = REGIONS.find((r) => r.code === countryCode)?.name ?? countryCode;

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle className="text-base">Estimated import duty &amp; local tax</CardTitle>
        <CardDescription>
          Estimate only — not a customs quote. Actual duty depends on HS code, product
          category, and customs, and the retailer sets the final price at checkout. Confirm
          with your carrier or customs before ordering.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="tax-country">Deliver to</Label>
            <Select value={countryCode} onValueChange={handleCountryChange}>
              <SelectTrigger id="tax-country">
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
          </div>
          <div className="space-y-2">
            <Label htmlFor="tax-duty">Import duty % (adjustable)</Label>
            <Input
              id="tax-duty"
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={dutyPct}
              onChange={(e) => setDutyPct(Number(e.target.value) || 0)}
            />
            <p className="text-xs text-muted-foreground">
              Placeholder default {DEFAULT_DUTY_PCT}% — adjust to your country&apos;s actual
              rate. No duty schedule is built in.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tax-vat">
              Local {standard ? standard.label : 'VAT / sales tax'} % (adjustable)
            </Label>
            <Input
              id="tax-vat"
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={vatPct}
              onChange={(e) => setVatPct(Number(e.target.value) || 0)}
            />
            {standard ? (
              <p className="text-xs text-muted-foreground">
                Standard rate for {countryName} ({standard.ratePct}%). Reduced rates and
                exemptions are not modelled — edit if yours differs.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {manualNote ??
                  'No standard rate is listed for this country — enter your local rate.'}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="tax-shipping">Shipping (USD, optional)</Label>
            <Input
              id="tax-shipping"
              type="number"
              min={0}
              step={1}
              value={shipping}
              onChange={(e) => setShipping(Number(e.target.value) || 0)}
            />
            <p className="text-xs text-muted-foreground">
              Leave 0 when unknown — no shipping cost is estimated for you.
            </p>
          </div>
        </div>

        <div className="space-y-2 rounded-lg border p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Merchant price (estimated)</span>
            <Price usd={estimate.priceUsd} />
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              Estimated import duty ({dutyPct}%)
            </span>
            <Price usd={estimate.dutyUsd} />
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Shipping (as entered)</span>
            <Price usd={estimate.shippingUsd} />
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              Estimated local tax ({vatPct}% on price + duty + shipping)
            </span>
            <Price usd={estimate.vatUsd} />
          </div>
          <div className="flex justify-between border-t pt-2 font-bold">
            <span>Estimated total landing price</span>
            <Price usd={estimate.totalUsd} />
          </div>
          <p className="text-xs text-muted-foreground">
            Formula: duty = price × duty%; tax = (price + duty + shipping) × tax%; total =
            price + duty + shipping + tax. This total is an estimate, not the amount any
            retailer will charge.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
