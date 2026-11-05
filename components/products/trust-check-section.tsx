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

  useEffect(() => {
    let cancelled = false;
    async function loadHistory() {
      try {
        const res = await fetch(`/api/v1/products/${slug}/prices?limit=500`, {
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const points: HistoryPoint[] = (json?.data?.history ?? []) as HistoryPoint[];
        const byRetailer = new Map<string, FakeSalePoint[]>();
        for (const p of points) {
          if (!p.retailerId) continue;
          const list = byRetailer.get(p.retailerId) ?? [];
          list.push({ price: Number(p.price), recordedAt: p.recordedAt });
          byRetailer.set(p.retailerId, list);
        }
        const nameById = new Map(merchants.map((m) => [m.merchantId, m.merchantName ?? 'Unnamed retailer']));
        const rows: FakeSaleRow[] = merchants.map((m) => {
          const series = byRetailer.get(m.merchantId);
          if (!series || series.length === 0) {
            return {
              merchantName: m.merchantName ?? 'Unnamed retailer',
              result: detectFakeSale([]),
              checked: false,
            };
          }
          return {
            merchantName: m.merchantName ?? 'Unnamed retailer',
            result: detectFakeSale(series),
            checked: true,
          };
        });
        // History rows for retailer ids with no priced listing (should
        // not normally happen) are shown, not silently dropped.
        for (const [retailerId, series] of byRetailer) {
          if (!nameById.has(retailerId)) {
            rows.push({
              merchantName: 'Unnamed retailer',
              result: detectFakeSale(series),
              checked: true,
            });
          }
        }
        if (!cancelled) setFakeSaleRows(rows);
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
