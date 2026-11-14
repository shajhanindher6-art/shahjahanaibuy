'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getRegionByCountry, convertUsd, formatPrice, formatUsd, REGIONS } from '@/lib/region';
import type { CurrencyCode } from '@/services/currency';
import { DEFAULT_DUTY_PCT, standardRateForCountry } from '@/services/tax-estimator';
import { buildStoreSearchUrl, getStoresForCountry } from '@/lib/stores';
import type { FxSource } from '@/services/fx-rates';
import { formatFxStatus } from '@/lib/fx-status';
import { buildGoUrl } from '@/lib/affiliate-beacon';

interface FxState {
  rates: Partial<Record<CurrencyCode, number>>;
  source: FxSource;
  fetchedAt: string | null;
}

/**
 * Regions compared in the arbitrage table (Option 12 delta: all 60
 * regions from lib/region.ts, up from 10). NO duty/tax rate is
 * invented for any region — the split is decided by the existing
 * standard-rate table in services/tax-estimator.ts:
 * - 23 regions have a listed standard tax rate (DE, FR, GB, IT, ES,
 *   NL, BE, AT, IE, PL, GR, TR, CH, JP, KR, SG, AU, IN, PK, MX, AE,
 *   SA, ZA) and compete for "lowest estimated landed cost".
 * - The other 37 (incl. US and CA, whose tax varies by state /
 *   province) render as "tax unknown" rows and NEVER compete — the
 *   existing cheapestCode rule (taxRatePct === null skips the row)
 *   is unchanged. Duty is the documented 10% placeholder for every
 *   non-US row, never a per-country schedule.
 * Regions whose tax table entry exists but which are NOT in the
 * region registry (PT, SE, DK, FI) cannot be compared — there is
 * no currency/locale for them here — and are left out honestly.
 */
const COMPARED_CODES = REGIONS.map((r) => r.code);

interface ArbitrageRow {
  code: string;
  name: string;
  currency: CurrencyCode;
  locale: string;
  priceUsd: number;
  priceLocal: number;
  dutyUsd: number;
  taxRatePct: number | null;
  taxUsd: number | null;
  landedUsd: number;
  landedLocal: number;
  storeName: string;
  storeUrl: string;
  storeKind: 'local' | 'global';
}

/**
 * Worldwide Price Comparison — Option 11, Phase 1 (Region Arbitrage Table).
 * Option 12 delta: all 60 regions from lib/region.ts are compared
 * (was 10); rows with an unknown tax rate are shown, never crowned
 * cheapest, and no duty/tax rate is invented for any region.
 *
 * HONESTY, enforced in the UI (this table must never imply what it
 * cannot prove):
 * - Every price here is an FX CONVERSION of the single real US
 *   merchant price. It is NOT a UK, JP, or any other country's
 *   retailer price. No local price, stock, discount, or deal is
 *   claimed for any region — the store link goes to that region's
 *   own search page so the shopper can check the retailer's price.
 * - Landed figures are ESTIMATES (duty at the documented 10%
 *   placeholder default, tax at standard rates where listed) and
 *   EXCLUDE shipping, which varies by carrier and is handled in
 *   the Landed Cost Calculator. "Lowest estimated landed cost"
 *   compares only rows with a known tax rate; rows whose tax
 *   varies are never crowned cheapest.
 * - The US row is domestic (no import duty). Every other row is an
 *   import estimate into that region.
 */
export function RegionArbitrageTable({
  priceUsd,
  productName,
  visitorCountryCode,
  productSlug,
  affiliateEnabled,
}: {
  /** Cheapest US merchant price in USD (a real recorded price). */
  priceUsd: number;
  productName: string;
  /** Visitor's country code, highlighted in the table. */
  visitorCountryCode: string;
  /** Product slug for the click beacon (null when unknown). */
  productSlug?: string | null;
  /** True only when the server reports an affiliate path configured. */
  affiliateEnabled?: boolean;
}) {
  const [fx, setFx] = useState<FxState | null>(null);
  const [fxFailed, setFxFailed] = useState(false);

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

  const rows = useMemo<ArbitrageRow[]>(() => {
    const out: ArbitrageRow[] = [];
    for (const code of COMPARED_CODES) {
      const region = getRegionByCountry(code);
      if (!region) continue;
      const currency = region.currency;
      const rate = fx?.rates[currency];
      const priceLocal = rate && rate > 0 ? priceUsd * rate : convertUsd(priceUsd, currency);
      // Domestic US purchase: no import duty. Everywhere else the
      // documented placeholder default applies (estimate only).
      const dutyUsd = code === 'US' ? 0 : (priceUsd * DEFAULT_DUTY_PCT) / 100;
      const standard = standardRateForCountry(code);
      const taxRatePct = standard ? standard.ratePct : null;
      const taxUsd = taxRatePct === null ? null : ((priceUsd + dutyUsd) * taxRatePct) / 100;
      const landedUsd = priceUsd + dutyUsd + (taxUsd ?? 0);
      const landedLocal = rate && rate > 0 ? landedUsd * rate : convertUsd(landedUsd, currency);
      const stores = getStoresForCountry(code);
      const first = stores.stores[0];
      out.push({
        code,
        name: region.name,
        currency,
        locale: region.locale,
        priceUsd,
        priceLocal,
        dutyUsd,
        taxRatePct,
        taxUsd,
        landedUsd,
        landedLocal,
        storeName: first ? first.name : 'Store search',
        storeUrl: first ? buildStoreSearchUrl(first, productName) : '#',
        storeKind: stores.kind,
      });
    }
    return out;
  }, [priceUsd, productName, fx]);

  // Step B: server-side affiliate transform for the store links.
  // Only runs when the product page reports affiliate enabled (the
  // common env-blank case makes no request at all). Until the
  // transform returns, links stay the plain search URLs; on any
  // failure they stay plain too. The transform route caps each
  // batch at 20 URLs, so 60 rows are sent in chunks of 20.
  const [transformedUrls, setTransformedUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!affiliateEnabled) return;
    const urls = rows.map((r) => r.storeUrl).filter((u) => u && u !== '#');
    if (urls.length === 0) return;
    let cancelled = false;
    const TRANSFORM_BATCH_SIZE = 20;
    const batches: string[][] = [];
    for (let i = 0; i < urls.length; i += TRANSFORM_BATCH_SIZE) {
      batches.push(urls.slice(i, i + TRANSFORM_BATCH_SIZE));
    }
    void Promise.all(
      batches.map((batch) =>
        fetch('/api/v1/affiliate/transform', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls: batch }),
        })
          .then((res) => (res.ok ? res.json() : null))
          .then((json) => {
            if (cancelled || !json?.success || !Array.isArray(json.data?.urls)) return;
            const next: Record<string, string> = {};
            batch.forEach((u, i) => {
              const t = json.data.urls[i];
              if (typeof t === 'string' && t.length > 0) next[u] = t;
            });
            setTransformedUrls((prev) => ({ ...prev, ...next }));
          })
          .catch(() => {
            // Links stay plain on any failure.
          })
      )
    );
    return () => {
      cancelled = true;
    };
  }, [affiliateEnabled, rows]);

  const cheapestCode = useMemo(() => {
    let best: ArbitrageRow | null = null;
    for (const row of rows) {
      // Only rows with a known tax rate compete: a row that excludes
      // tax cannot honestly be called cheapest.
      if (row.taxRatePct === null) continue;
      if (!best || row.landedUsd < best.landedUsd) best = row;
    }
    return best?.code ?? null;
  }, [rows]);

  function formatLocal(row: ArbitrageRow, usd: number): string {
    const rate = fx?.rates[row.currency];
    const converted = rate && rate > 0 ? usd * rate : convertUsd(usd, row.currency);
    // Stage 2, S2-2: canonical formatter (identical output).
    return formatPrice(converted, row.currency, row.locale);
  }

  // FX status line (Option 12 delta): the feed's own last-update
  // date AND time when reported; an honest "unavailable" when the
  // API returns no fetchedAt (static fallback). Shared wording
  // with the landed-cost calculator — see lib/fx-status.ts.
  const fxStatus = formatFxStatus(fx, fxFailed);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Worldwide Price Comparison — Option 11</CardTitle>
        <CardDescription>
          Estimate only, before shipping. Prices below are FX conversions of the real US
          merchant price — NOT local retailer prices. No local price, stock, or discount is
          claimed; use the store link to check the retailer&apos;s own price.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{fxStatus}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Region</th>
                <th className="py-2 pr-3 font-medium">Price (FX converted)</th>
                <th className="py-2 pr-3 font-medium">Duty est.</th>
                <th className="py-2 pr-3 font-medium">Tax est.</th>
                <th className="py-2 pr-3 font-medium">Landed est. (excl. shipping)</th>
                <th className="py-2 font-medium">Check locally</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.code} className="border-b last:border-0">
                  <td className="py-2 pr-3">
                    <span className="font-medium">{row.name}</span>{' '}
                    <span className="text-muted-foreground">({row.code})</span>
                    <div className="flex flex-wrap gap-1 pt-1">
                      {row.code === visitorCountryCode.toUpperCase() && (
                        <Badge variant="secondary">Your region</Badge>
                      )}
                      {row.code === cheapestCode && (
                        <Badge>Lowest estimated landed cost</Badge>
                      )}
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    {formatLocal(row, row.priceUsd)}
                    <div className="text-xs text-muted-foreground">
                      {formatUsd(row.priceUsd)}
                      {fx?.source !== 'live' && row.currency !== 'USD' ? ' ≈' : ''}
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    {row.code === 'US' ? (
                      <span className="text-muted-foreground">— (domestic)</span>
                    ) : (
                      <>
                        {formatUsd(row.dutyUsd)}
                        <div className="text-xs text-muted-foreground">
                          {DEFAULT_DUTY_PCT}% placeholder
                        </div>
                      </>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {row.taxUsd === null ? (
                      <span className="text-muted-foreground">Varies — enter rate</span>
                    ) : (
                      <>
                        {formatUsd(row.taxUsd)}
                        <div className="text-xs text-muted-foreground">
                          {row.taxRatePct}% standard
                        </div>
                      </>
                    )}
                  </td>
                  <td className="py-2 pr-3 font-medium">
                    {formatLocal(row, row.landedUsd)}
                    <div className="text-xs font-normal text-muted-foreground">
                      {formatUsd(row.landedUsd)}
                      {row.taxUsd === null ? ' (excl. tax)' : ''}
                    </div>
                  </td>
                  <td className="py-2">
                    <a
                      href={
                        row.storeUrl === '#'
                          ? '#'
                          : buildGoUrl(transformedUrls[row.storeUrl] ?? row.storeUrl, {
                              productSlug: productSlug ?? null,
                              merchantName: row.storeName,
                            })
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2"
                    >
                      Search on {row.storeName}
                    </a>
                    <div className="text-xs text-muted-foreground">
                      {row.storeKind === 'global' ? 'Global retailer search' : 'Local store search'}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          How to read this: the US merchant price ({formatUsd(priceUsd)}) is converted into
          each currency, then duty (10% placeholder default, 0 for domestic US) and standard
          tax (where listed) are added. Rows whose tax is unknown exclude tax from the landed
          figure and never compete for lowest cost. Shipping is excluded — use the Landed Cost
          Calculator above with your real shipping quote.
        </p>
      </CardContent>
    </Card>
  );
}
