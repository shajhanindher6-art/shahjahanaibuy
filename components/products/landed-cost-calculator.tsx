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
import { REGIONS, convertUsd, getRegionByCountry } from '@/lib/region';
import type { CurrencyCode } from '@/services/currency';
import {
  DEFAULT_DUTY_PCT,
  estimateLandingPrice,
  manualRateNote,
  standardRateForCountry,
} from '@/services/tax-estimator';
import { deMinimisForCountry } from '@/services/duty-optimizer';
import type { FxSource } from '@/services/fx-rates';
import { formatFxStatus } from '@/lib/fx-status';

interface FxState {
  rates: Partial<Record<CurrencyCode, number>>;
  source: FxSource;
  fetchedAt: string | null;
}

/**
 * Cross-Border Landed Cost Calculator — Option 11, Phase 1.
 * Extends the Option 7 tax estimator (same formula, same rate tables,
 * same honesty rules) with a destination picker and live-daily FX
 * conversion, so a shopper can see the full estimated cost of
 * importing the US-listed product into THEIR country.
 *
 * HONESTY, enforced in the UI:
 * - Headed "Estimate only — not a customs quote" on every render.
 * - Shipping is user-entered (0 when unknown); no carrier quote is
 *   ever invented. Duty % is the documented placeholder default
 *   (10%), always editable. VAT uses the standard-rate table where
 *   listed; US/CA/unlisted countries ask for a manual rate.
 * - De minimis is asserted ONLY for the US ($800, Section 321).
 *   Every other country shows "threshold unknown — no threshold
 *   benefit assumed" and duty applies in full.
 * - FX: live daily feed when reachable, otherwise approximate
 *   static rates labelled with "≈". The total is never presented
 *   as a retailer's checkout total.
 */
export function LandedCostCalculator({
  priceUsd,
  defaultCountryCode,
}: {
  /** Cheapest merchant price in USD (a real recorded price). */
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
  const [fx, setFx] = useState<FxState | null>(null);
  const [fxFailed, setFxFailed] = useState(false);

  // Same follow-the-prop-until-picked pattern as TaxEstimator: region
  // detection finishes after first render, so a stale fallback (US)
  // must not stick once the visitor's real country is known.
  const userPickedCountry = useRef(false);
  useEffect(() => {
    if (!userPickedCountry.current && defaultCountryCode !== countryCode) {
      setCountryCode(defaultCountryCode);
      const next = standardRateForCountry(defaultCountryCode);
      setVatPct(next ? next.ratePct : 0);
    }
  }, [defaultCountryCode, countryCode]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/v1/fx-rates')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled) return;
        if (json?.success && json.data?.rates) {
          setFx({
            rates: json.data.rates as Partial<Record<CurrencyCode, number>>,
            source: (json.data.source as FxSource) ?? 'static',
            fetchedAt: (json.data.fetchedAt as string | null) ?? null,
          });
        } else {
          setFxFailed(true);
        }
      })
      .catch(() => {
        // Static fallback below (region convertUsd) covers this.
        if (!cancelled) setFxFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleCountryChange(code: string) {
    userPickedCountry.current = true;
    setCountryCode(code);
    const next = standardRateForCountry(code);
    setVatPct(next ? next.ratePct : 0);
  }

  const region = getRegionByCountry(countryCode);
  const currency: CurrencyCode = region?.currency ?? 'USD';
  const threshold = deMinimisForCountry(countryCode);
  const thresholdApplies = threshold !== null && priceUsd < threshold;

  const estimate = useMemo(() => {
    if (thresholdApplies) {
      // US Section 321 style: a shipment under the threshold is
      // duty- and tax-free. This branch runs ONLY for the US, the
      // single country with an asserted threshold.
      return {
        priceUsd: Math.round(priceUsd * 100) / 100,
        dutyUsd: 0,
        shippingUsd: Math.round(Math.max(0, shipping || 0) * 100) / 100,
        vatBaseUsd: 0,
        vatUsd: 0,
        totalUsd: Math.round((priceUsd + Math.max(0, shipping || 0)) * 100) / 100,
      };
    }
    return estimateLandingPrice({
      priceUsd,
      dutyPct,
      vatPct,
      shippingUsd: shipping,
    });
  }, [priceUsd, dutyPct, vatPct, shipping, thresholdApplies]);

  function formatLocal(usd: number): string {
    const converted =
      fx && fx.rates[currency] ? usd * (fx.rates[currency] as number) : convertUsd(usd, currency);
    return new Intl.NumberFormat(region?.locale ?? 'en-US', {
      style: 'currency',
      currency,
    }).format(converted);
  }

  function formatUsd(usd: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(usd);
  }

  // FX status line (Option 12 delta): the feed's own last-update
  // date AND time when reported; an honest "unavailable" when the
  // API returns no fetchedAt (static fallback). Shared wording
  // with the arbitrage table — see lib/fx-status.ts.
  const fxStatus = formatFxStatus(fx, fxFailed);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cross-Border Landed Cost — Option 11</CardTitle>
        <CardDescription>
          Estimate only — not a customs quote. Full estimated cost of importing this US-listed
          product into your country: product price + shipping + duty + tax. Never a retailer
          checkout total.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="landed-destination">Deliver to</Label>
            <Select value={countryCode} onValueChange={handleCountryChange}>
              <SelectTrigger id="landed-destination">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REGIONS.map((r) => (
                  <SelectItem key={r.code} value={r.code}>
                    {r.name} ({r.currency})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="landed-shipping">Shipping (USD, your estimate)</Label>
            <Input
              id="landed-shipping"
              type="number"
              min={0}
              step="0.01"
              value={Number.isFinite(shipping) ? shipping : 0}
              onChange={(e) => setShipping(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="landed-duty">Import duty (%)</Label>
            <Input
              id="landed-duty"
              type="number"
              min={0}
              step="0.1"
              value={Number.isFinite(dutyPct) ? dutyPct : 0}
              onChange={(e) => setDutyPct(Math.max(0, Number(e.target.value) || 0))}
              disabled={thresholdApplies}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="landed-vat">
              {standard ? `${standard.label} (%)` : 'Tax rate (%)'}
            </Label>
            <Input
              id="landed-vat"
              type="number"
              min={0}
              step="0.1"
              value={Number.isFinite(vatPct) ? vatPct : 0}
              onChange={(e) => setVatPct(Math.max(0, Number(e.target.value) || 0))}
              disabled={thresholdApplies}
            />
          </div>
        </div>

        {thresholdApplies && threshold !== null && (
          <p className="text-sm text-muted-foreground">
            US de minimis (Section 321): orders under {formatUsd(threshold)} are duty- and
            tax-free, so duty and tax are 0 here. Shipping still applies.
          </p>
        )}
        {!thresholdApplies && (
          <p className="text-sm text-muted-foreground">
            {threshold === null
              ? 'De minimis threshold unknown for this country — no threshold benefit assumed, duty applies in full.'
              : `Order value is at or above the US de minimis threshold (${formatUsd(threshold)}), so duty and tax apply.`}
          </p>
        )}
        {manualNote && !thresholdApplies && (
          <p className="text-sm text-muted-foreground">{manualNote}</p>
        )}
        {!standard && !manualNote && !thresholdApplies && (
          <p className="text-sm text-muted-foreground">
            No standard tax rate listed for this country — enter your local rate above.
          </p>
        )}

        <dl className="space-y-1 text-sm">
          <div className="flex justify-between">
            <dt>Product price (cheapest US merchant)</dt>
            <dd>
              {formatUsd(estimate.priceUsd)}
              {currency !== 'USD' && <span className="text-muted-foreground"> · {formatLocal(estimate.priceUsd)}</span>}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>Shipping (your estimate)</dt>
            <dd>
              {formatUsd(estimate.shippingUsd)}
              {currency !== 'USD' && <span className="text-muted-foreground"> · {formatLocal(estimate.shippingUsd)}</span>}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>Import duty (estimate)</dt>
            <dd>
              {formatUsd(estimate.dutyUsd)}
              {currency !== 'USD' && <span className="text-muted-foreground"> · {formatLocal(estimate.dutyUsd)}</span>}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>Tax (estimate)</dt>
            <dd>
              {formatUsd(estimate.vatUsd)}
              {currency !== 'USD' && <span className="text-muted-foreground"> · {formatLocal(estimate.vatUsd)}</span>}
            </dd>
          </div>
          <div className="flex justify-between border-t pt-2 font-semibold">
            <dt>Estimated landed total</dt>
            <dd>
              {formatUsd(estimate.totalUsd)}
              {currency !== 'USD' && <span className="text-muted-foreground"> · {formatLocal(estimate.totalUsd)}</span>}
            </dd>
          </div>
        </dl>

        <p className="text-xs text-muted-foreground">{fxStatus}</p>

        <p className="text-xs text-muted-foreground">
          Formula: duty = price × duty%; tax = (price + duty + shipping) × tax%; total = price +
          duty + shipping + tax. Duty % is a placeholder default (10%), not a per-country
          schedule — confirm the real duty with your carrier or customs.
        </p>
      </CardContent>
    </Card>
  );
}
