/**
 * Landed Cost widget — Option 12 delta (dashboard summary).
 *
 * A COMPACT summary only: estimated landed cost (price + duty +
 * tax, shipping excluded) for the user's tracked products in their
 * region, from GET /api/v1/dashboard/landed-cost. It does NOT
 * duplicate the full Landed Cost Calculator — each row links to
 * the product page for the full breakdown, and the duty/tax
 * inputs live only there.
 *
 * Honesty, same rules as the calculator it summarises:
 * - Duty is the documented 10% placeholder default, never a
 *   per-country schedule; shipping is excluded (0) and labelled.
 * - Rows whose region has no listed standard tax rate show the
 *   landed figure "(excl. tax)" — never a guessed tax.
 * - FX is the same daily feed; the "last updated" line comes from
 *   the API's fetchedAt (honest "unavailable" on static fallback).
 * - Empty states are honest: "no tracked products yet" when the
 *   user tracks nothing, and a separate note when tracked items
 *   have no recorded price yet.
 */

'use client';

import { tFor } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Globe, ArrowRight } from 'lucide-react';
import { formatPrice, formatUsd } from '@/lib/region';
import { formatFxStatus } from '@/lib/fx-status';
import { useRegion } from '@/components/region/region-provider';
import type { CurrencyCode } from '@/services/currency';
import type { FxSource } from '@/services/fx-rates';

interface WidgetItem {
  productId: string;
  productName: string;
  productSlug: string;
  priceUsd: number;
  dutyUsd: number;
  taxUsd: number | null;
  landedUsd: number;
  landedLocal: number;
  taxUnknown: boolean;
  dutyFree: boolean;
}

interface WidgetData {
  country: string;
  countryName: string;
  currency: CurrencyCode;
  locale: string;
  dutyPct: number;
  taxRatePct: number | null;
  taxLabel: string | null;
  items: WidgetItem[];
  fx: { source: FxSource; fetchedAt: string | null; provider: string | null };
}

export function LandedCostWidget() {
  const { countryCode, region, language } = useRegion();
  const [data, setData] = useState<WidgetData | null>(null);
  const [trackedCount, setTrackedCount] = useState(0);
  const [unpricedCount, setUnpricedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    fetch(`/api/v1/dashboard/landed-cost?country=${encodeURIComponent(countryCode)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled) return;
        if (json?.success && json.data) {
          setData(json.data as WidgetData);
          setTrackedCount(json.meta?.trackedCount ?? 0);
          setUnpricedCount(json.meta?.unpricedCount ?? 0);
        } else {
          setFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [countryCode]);

  function formatLocal(usdLocal: number, currency: CurrencyCode, locale: string): string {
    // Stage 2, S2-2: canonical formatter (identical output — the
    // currency's default fraction digits, same as the inline call).
    return formatPrice(usdLocal, currency, locale);
  }

  return (
    <section
      id="landed-cost"
      className="animate-fade-in motion-reduce:animate-none"
      style={{ animationDelay: '310ms' }}
    >
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
        <Globe className="h-5 w-5 text-blue-600" /> Landed cost in{' '}
        {data?.countryName ?? region.name}
      </h2>
      <p className="-mt-2 mb-4 text-xs text-muted-foreground">
        Estimated landed cost for your tracked products — price + duty + tax, shipping excluded.
        Full breakdown on each product page.
      </p>
      {loading ? (
        <div className="glass-card animate-shimmer h-32" />
      ) : failed ? (
        <div className="glass-card p-6 text-center">
          <p className="text-sm font-medium">Could not load landed-cost estimates</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Try again later — your tracked products are unaffected.
          </p>
        </div>
      ) : trackedCount === 0 ? (
        <div className="glass-card p-6 text-center">
          <p className="text-sm font-medium">{tFor(language, 'dashNoTrackedProducts')}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Save products to a wishlist and their estimated landed cost in your region will
            appear here.
          </p>
          <Link
            href="/search"
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
          >
            Find products to track <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      ) : data && data.items.length === 0 ? (
        <div className="glass-card p-6 text-center">
          <p className="text-sm font-medium">No recorded price yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Your tracked products have no recorded price yet — a landed estimate needs a real
            recorded price.
          </p>
        </div>
      ) : data ? (
        <div className="glass-card space-y-2 p-4">
          {data.items.map((item) => (
            <Link
              key={item.productId}
              href={`/products/${item.productSlug}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg p-2 transition-colors hover:bg-muted/70"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.productName}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatUsd(item.priceUsd)} price
                  {item.dutyFree
                    ? ' · duty- & tax-free (US de minimis)'
                    : item.taxUnknown
                      ? ' · tax unknown — excl. tax'
                      : ` · incl. ${data.taxRatePct}% ${data.taxLabel ?? 'tax'}`}
                  {' · '}
                  <span className="underline underline-offset-2">full breakdown</span>
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-bold text-blue-600">
                  {data.currency === 'USD'
                    ? formatUsd(item.landedUsd)
                    : formatLocal(item.landedLocal, data.currency, data.locale)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {data.currency === 'USD'
                    ? 'estimated landed total'
                    : `${formatUsd(item.landedUsd)} landed${item.taxUnknown ? ' (excl. tax)' : ''}`}
                </p>
              </div>
            </Link>
          ))}
          {unpricedCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {unpricedCount} tracked {unpricedCount === 1 ? 'item has' : 'items have'} no
              recorded price yet and {unpricedCount === 1 ? 'is' : 'are'} not shown.
            </p>
          )}
          <p className="border-t pt-2 text-xs text-muted-foreground">
            Estimate only — not a customs quote. Duty is the {data.dutyPct}% placeholder
            default, shipping excluded. {formatFxStatus(data.fx, false)}
          </p>
        </div>
      ) : null}
    </section>
  );
}
