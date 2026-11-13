'use client';

import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, ShieldAlert, ShieldQuestion, Link2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TrustSignals } from '@/components/products/trust-signals';
import { analyzeReviewAuthenticity, type AuthenticityReview } from '@/services/review-authenticity';
import {
  checkLink,
  hostnameFromUrl,
  type LinkCheckResult,
  type PricedMerchantDomain,
} from '@/services/link-check';
import {
  detectFakeSale,
  FAKE_SALE_MIN_RISE,
  FAKE_SALE_WINDOW_DAYS,
  type FakeSalePoint,
  type FakeSaleResult,
} from '@/services/fake-sale';

/** Subset of the product page's merchant listing actually needed here. */
export interface TrustCheckMerchant {
  merchantId: string;
  merchantName: string | null;
  url: string | null;
}

/** Subset of the product page's review actually needed here. */
export interface TrustCheckReview extends AuthenticityReview {}

interface HistoryPoint {
  retailerId: string;
  price: number | string;
  recordedAt: string;
}

interface FakeSaleRow {
  merchantName: string;
  result: FakeSaleResult;
  checked: boolean;
}

/**
 * Trust Check — Option 11, Phase 2 (AI Trust & Protection Layer).
 * ONE place on the product page for trust, replacing the old
 * standalone TrustSignals render (same component, same props, now
 * alongside the two new Phase 2 checks):
 *  (1) Unified trust score — the existing Option 8 TrustSignals
 *      card (verdict + score + formula, score hidden when
 *      insufficient) plus a compact review-authenticity line from
 *      the existing Option 9 analyzer over the same real reviews.
 *  (2) Link checker — a pasted product/seller link is parsed ON
 *      THE DEVICE and matched against this product's priced
 *      merchants. No scraping, no fetch, nothing sent or stored.
 *      An unknown domain is never labeled fake/scam.
 *  (3) Fake Sale check — per-retailer price-history scan for a
 *      ≥10% rise within 30 days followed by a drop to a price not
 *      below the pre-rise price. Wording is pattern-only, never
 *      an intent claim. A retailer with no history is "unchecked",
 *      never "clean".
 */
export function TrustCheckSection({
  slug,
  merchantNames,
  knownRetailers,
  totalReviews,
  ratingDistribution,
  priceUsd,
  imageUrl,
  merchants,
  reviews,
}: {
  slug: string;
  merchantNames: string[];
  knownRetailers: string[];
  totalReviews: number;
  ratingDistribution: Record<number, number>;
  priceUsd: number | null;
  imageUrl: string | null;
  merchants: TrustCheckMerchant[];
  reviews: TrustCheckReview[];
}) {
  const authenticity = useMemo(() => analyzeReviewAuthenticity(reviews), [reviews]);

  const pricedDomains = useMemo<PricedMerchantDomain[]>(
    () =>
      merchants.map((m) => ({
        merchantName: m.merchantName ?? 'Unnamed retailer',
        hostname: hostnameFromUrl(m.url),
      })),
    [merchants]
  );

  const [linkInput, setLinkInput] = useState('');
  const [linkResult, setLinkResult] = useState<LinkCheckResult | null>(null);

  const [fakeSaleRows, setFakeSaleRows] = useState<FakeSaleRow[] | null>(null);
  const [fakeSaleFailed, setFakeSaleFailed] = useState(false);
  // Section 19, Phase 2 (§12 #19): the raw recorded points, kept
  // so the unified TrustSignals card can run its time-series
  // anomaly checks (spike/drop, flatline) on the same history the
  // Fake Sale scan already fetched — no second request.
  const [historyPoints, setHistoryPoints] = useState<Array<{ price: number; recordedAt: string }> | null>(null);
  // Latest recorded price per retailer name, for the
  // cross-merchant outlier check — derived from the same series.
  const [merchantPrices, setMerchantPrices] = useState<Array<{ merchant: string; price: number }>>([]);

  useEffect(() => {
    let cancelled = false;
    async function loadHistory() {
      try {
        const [pricesRes, retailersRes] = await Promise.all([
          fetch(`/api/v1/products/${slug}/prices?limit=500`, {
            signal: AbortSignal.timeout(15000),
          }),
          // Retailer-name join (2026-11-05 fix): price_history.retailer_id
          // points at the RETAILERS table, while the priced merchants
          // carry MERCHANTS-table ids — two different id spaces, so an
          // id join can never match. Join by retailer NAME instead.
          // A failed retailers fetch only loses names (rows then show
          // as "Unnamed retailer"); it never blocks the price check.
          fetch('/api/v1/retailers?pageSize=100', {
            signal: AbortSignal.timeout(15000),
          }).catch(() => null),
        ]);
        if (!pricesRes.ok) throw new Error(`HTTP ${pricesRes.status}`);
        const json = await pricesRes.json();
        const points: HistoryPoint[] = (json?.data?.history ?? []) as HistoryPoint[];

        const nameByRetailerId = new Map<string, string>();
        if (retailersRes && retailersRes.ok) {
          try {
            const rJson = await retailersRes.json();
            for (const r of (rJson?.data ?? []) as Array<{ id: string; name: string }>) {
              if (r.id && r.name) nameByRetailerId.set(r.id, r.name);
            }
          } catch {
            // Names unknown; series below fall back to "Unnamed retailer".
          }
        }

        // Group history by normalized retailer NAME, not by id.
        const byName = new Map<string, { displayName: string; series: FakeSalePoint[] }>();
        for (const p of points) {
          if (!p.retailerId) continue;
          const displayName = nameByRetailerId.get(p.retailerId) ?? 'Unnamed retailer';
          const key = displayName.toLowerCase();
          const entry = byName.get(key) ?? { displayName, series: [] };
          entry.series.push({ price: Number(p.price), recordedAt: p.recordedAt });
          byName.set(key, entry);
        }

        // One row per DISTINCT priced merchant name; a priced merchant
        // with no history series is honestly "cannot check" (e.g. the
        // seed records history for Amazon only, so Best Buy has none).
        const seen = new Set<string>();
        const rows: FakeSaleRow[] = [];
        for (const m of merchants) {
          const displayName = m.merchantName ?? 'Unnamed retailer';
          const key = displayName.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          const entry = byName.get(key);
          rows.push({
            merchantName: displayName,
            result: detectFakeSale(entry ? entry.series : []),
            checked: Boolean(entry && entry.series.length > 0),
          });
        }
        // History series under a name with no priced listing are shown
        // under their retailer name, not silently dropped.
        for (const [key, entry] of byName) {
          if (!seen.has(key)) {
            rows.push({
              merchantName: entry.displayName,
              result: detectFakeSale(entry.series),
              checked: true,
            });
          }
        }
        if (!cancelled) setFakeSaleRows(rows);
        // Section 19, Phase 2 (§12 #19): hand the same recorded
        // points to the TrustSignals card for its time-series
        // checks, plus the latest price per retailer for the
        // cross-merchant outlier check.
        if (!cancelled) {
          setHistoryPoints(
            points
              .filter((p) => Number.isFinite(Number(p.price)) && Number(p.price) > 0)
              .map((p) => ({ price: Number(p.price), recordedAt: p.recordedAt }))
          );
          setMerchantPrices(
            Array.from(byName.values()).map((entry) => {
              const sorted = [...entry.series].sort(
                (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
              );
              return { merchant: entry.displayName, price: sorted[sorted.length - 1].price };
            })
          );
        }
      } catch {
        if (!cancelled) setFakeSaleFailed(true);
      }
    }
    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [slug, merchants]);

  const linkIcon =
    linkResult?.verdict === 'priced-seller'
      ? ShieldCheck
      : linkResult?.verdict === 'unknown'
        ? ShieldQuestion
        : linkResult
          ? ShieldAlert
          : Link2;

  return (
    <div className="space-y-4">
      {/* (1) Unified trust score: existing Option 8 card, unchanged. */}
      <TrustSignals
        slug={slug}
        merchantNames={merchantNames}
        knownRetailers={knownRetailers}
        totalReviews={totalReviews}
        ratingDistribution={ratingDistribution}
        priceUsd={priceUsd}
        imageUrl={imageUrl}
        priceHistory={historyPoints ?? undefined}
        merchantPrices={merchantPrices.length > 0 ? merchantPrices : undefined}
      />

      {/* (1b) Review authenticity, compact: full analysis stays in the Reviews tab. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Review authenticity — Option 11 Phase 2</CardTitle>
          <CardDescription>
            Same real reviews as the Reviews tab, checked for patterns only. A pattern is not
            proof that a review was paid for, and no reviewer is ever named or accused.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {authenticity.totalReviews === 0 ? (
            <p className="text-sm text-muted-foreground">
              No reviews to analyze — no badge, no score. This check can only fire once real
              reviews exist (10+ reviews needed for any pattern badge).
            </p>
          ) : authenticity.showWarning ? (
            <p className="text-sm">
              Some reviews show patterns consistent with incentivized reviews — treat ratings
              with caution. ({authenticity.signals.filter((s) => s.strength !== 'none').length}{' '}
              pattern signal(s) across {authenticity.totalReviews} reviews; trusted-subset
              average{' '}
              {authenticity.trustedAverage !== null
                ? authenticity.trustedAverage.toFixed(1)
                : '—'}{' '}
              from {authenticity.trustedCount} trusted reviews.)
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No authenticity warning: review patterns look ordinary across{' '}
              {authenticity.totalReviews} review(s).
            </p>
          )}
        </CardContent>
      </Card>

      {/* (2) Link checker — parsed on the device, nothing sent or stored. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-5 w-5" /> Check a product or seller link
          </CardTitle>
          <CardDescription>
            Paste a link and SmartBuy checks whether its domain matches a retailer that prices
            this product here. Parsed on your device only — no scraping, no fetch, nothing sent
            or stored.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="trust-link-input">Product or seller link</Label>
            <div className="flex gap-2">
              <Input
                id="trust-link-input"
                type="text"
                inputMode="url"
                placeholder="https://www.amazon.com/dp/…"
                value={linkInput}
                onChange={(e) => setLinkInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setLinkResult(checkLink(linkInput, pricedDomains));
                }}
              />
              <Button onClick={() => setLinkResult(checkLink(linkInput, pricedDomains))}>
                Check
              </Button>
            </div>
          </div>
          {linkResult && (
            <div className="flex flex-wrap items-center gap-2">
              {(() => {
                const Icon = linkIcon;
                return <Icon className="h-5 w-5" />;
              })()}
              <Badge
                variant={
                  linkResult.verdict === 'priced-seller'
                    ? 'default'
                    : linkResult.verdict === 'invalid'
                      ? 'secondary'
                      : 'secondary'
                }
              >
                {linkResult.verdict === 'priced-seller'
                  ? `Matches priced seller: ${linkResult.merchantName}`
                  : linkResult.verdict === 'known-not-priced'
                    ? 'Known retailer, not priced here'
                    : linkResult.verdict === 'unknown'
                      ? 'Unknown seller'
                      : 'Could not parse'}
              </Badge>
              <p className="text-sm">{linkResult.message}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* (3) Fake Sale check — per-retailer price-history scan. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fake Sale check — Option 11 Phase 2</CardTitle>
          <CardDescription>
            Scans each retailer&apos;s recorded price history for a price raised by{' '}
            {Math.round(FAKE_SALE_MIN_RISE * 100)}% or more within {FAKE_SALE_WINDOW_DAYS} days
            and then dropped to a price not below the pre-rise price. A hit describes the price
            pattern only — never the retailer&apos;s intent.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {fakeSaleFailed ? (
            <p className="text-sm text-muted-foreground">
              Price history could not be loaded, so the Fake Sale check could not run. No
              retailer is marked clean on missing data.
            </p>
          ) : fakeSaleRows === null ? (
            <p className="text-sm text-muted-foreground">Checking recorded price history…</p>
          ) : fakeSaleRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No priced retailers to check — add a merchant listing first.
            </p>
          ) : (
            <ul className="space-y-2">
              {fakeSaleRows.map((row) => (
                <li key={row.merchantName} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{row.merchantName}:</span>
                  {!row.checked ? (
                    <span className="text-muted-foreground">
                      No price history — cannot check for a pre-sale rise.
                    </span>
                  ) : row.result.alert ? (
                    <span>
                      <Badge variant="destructive">Fake Sale pattern</Badge>{' '}
                      {row.result.explanation}
                    </span>
                  ) : row.result.pointsInWindow < 2 ? (
                    <span className="text-muted-foreground">
                      Not enough history in the last {FAKE_SALE_WINDOW_DAYS} days to check
                      (needs at least 2 recorded prices).
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      No pre-sale rise detected in the last {FAKE_SALE_WINDOW_DAYS} days.
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Negative test, kept by design: a plain drop with no prior rise (e.g. $1,018.98 →{' '}
            $999.00) never triggers this badge.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
