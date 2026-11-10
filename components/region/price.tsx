'use client';

/**
 * <Price usd={...} /> — the single price renderer for the Global
 * website system.
 *
 * - USD visitors see exactly what they saw before: "$999.00".
 * - Other regions see an APPROXIMATE conversion prefixed with "≈",
 *   plus the original USD value in small muted text, e.g.
 *   "≈ Rs 279,720  $999.00".
 * - `showOriginal={false}` hides the small USD text (used for
 *   strikethrough compare-at prices, where it would clutter).
 *
 * LIVE FX (S2#9 / S3#19): converted prices now use the LIVE daily
 * rate from GET /api/v1/fx-rates (open.er-api.com, daily feed — see
 * services/fx-rates.ts) when it responds, with the APPROXIMATE
 * static table (lib/region.ts) as fallback. The rate date is shown
 * in the hover tooltip on every converted price and, when
 * `showFxNote` is set, as a small visible line ("live daily rate ·
 * 10 Nov 2026"). It is NEVER labelled "real-time": the free feed
 * publishes daily rates, not tick-by-tick trading rates.
 *
 * One shared fetch: dozens of <Price> instances can render on one
 * page, so the /api/v1/fx-rates request is cached in module scope
 * (single in-flight promise, 12h TTL matching the server's
 * revalidate) instead of one request per price. A failed fetch
 * simply leaves every price on the static fallback — prices never
 * block on FX. Never import services/fx-rates.ts from this client
 * component; the API route is the only bridge.
 */

import { useEffect, useState } from 'react';
import {
  formatPriceForRegion,
  formatPriceForRegionWithRates,
  formatUsd,
  type LiveFxRates,
} from '@/lib/region';
import { formatFxShortLabel, formatFxStatus } from '@/lib/fx-status';
import { useRegion } from './region-provider';
import { cn } from '@/lib/utils';

const FX_TTL_MS = 12 * 60 * 60 * 1000; // 12h — matches the server revalidate.

let fxCache: { data: LiveFxRates; atMs: number } | null = null;
let fxPromise: Promise<LiveFxRates | null> | null = null;

function fetchLiveFxRates(): Promise<LiveFxRates | null> {
  if (fxCache && Date.now() - fxCache.atMs < FX_TTL_MS) {
    return Promise.resolve(fxCache.data);
  }
  if (!fxPromise) {
    fxPromise = fetch('/api/v1/fx-rates')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.success && json.data?.rates) {
          const data: LiveFxRates = {
            rates: json.data.rates as LiveFxRates['rates'],
            source: (json.data.source as LiveFxRates['source']) ?? 'static',
            fetchedAt: (json.data.fetchedAt as string | null) ?? null,
          };
          fxCache = { data, atMs: Date.now() };
          return data;
        }
        return null;
      })
      .catch(() => null)
      .finally(() => {
        fxPromise = null;
      });
  }
  return fxPromise;
}

/** Shared live-FX state: one fetch per page load, reused by every <Price>. */
function useLiveFxRates(): { fx: LiveFxRates | null; failed: boolean } {
  const [fx, setFx] = useState<LiveFxRates | null>(() => fxCache?.data ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // A fresh cache entry means no fetch at all (e.g. navigating
    // between pages in one session).
    if (fxCache && Date.now() - fxCache.atMs < FX_TTL_MS) {
      setFx(fxCache.data);
      return;
    }
    fetchLiveFxRates().then((data) => {
      if (cancelled) return;
      if (data) {
        setFx(data);
      } else {
        setFailed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { fx, failed };
}

interface PriceProps {
  /** Price in USD (all catalog prices are stored in USD). */
  usd: number;
  className?: string;
  /** Show the small original USD value next to a converted price. */
  showOriginal?: boolean;
  /**
   * Also render the small visible FX line under the price
   * ("live daily rate · 10 Nov 2026" / "approx. static rate").
   * Default false — most surfaces keep the rate date in the hover
   * tooltip only, so prices stay compact.
   */
  showFxNote?: boolean;
}

export function Price({ usd, className, showOriginal = true, showFxNote = false }: PriceProps) {
  const { region } = useRegion();
  const { fx, failed } = useLiveFxRates();

  // While the live feed is still in flight (or failed), the static
  // table renders immediately — the price never waits on FX.
  const formatted = fx
    ? formatPriceForRegionWithRates(usd, region, fx)
    : formatPriceForRegion(usd, region);
  const { display, approximate } = formatted;

  if (!approximate) {
    return <span className={className}>{display}</span>;
  }

  // Honest rate wording on every converted price: live daily rate
  // + the feed's own date, or the static-fallback note. Never
  // "real-time".
  const fxStatus = formatFxStatus(fx, failed);
  const fxLabel = formatFxShortLabel(fx, failed);

  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-x-1.5', className)} title={fxStatus}>
      <span>≈ {display}</span>
      {showOriginal && (
        <span className="text-xs font-normal text-muted-foreground">{formatUsd(usd)}</span>
      )}
      {showFxNote && fxLabel && (
        <span className="w-full text-[11px] font-normal text-muted-foreground">{fxLabel}</span>
      )}
    </span>
  );
}
