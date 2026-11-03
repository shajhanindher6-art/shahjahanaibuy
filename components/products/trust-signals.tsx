'use client';

import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { analyzeTrust, type TrustResult } from '@/services/trust-signals';

interface SimilarProduct {
  slug: string;
}

interface MerchantListing {
  price: number;
  availability?: string;
  inStock?: boolean;
}

/**
 * Counterfeit & scam detector (Option 8, Feature 4) — real signals only.
 * Verdict vocabulary is restricted to: "No scam signals detected",
 * "Caution — <specific real reason>", or "Insufficient data". No merchant
 * or product is ever labeled fake/scam/counterfeit.
 */
export function TrustSignals({
  slug,
  merchantNames,
  knownRetailers,
  totalReviews,
  ratingDistribution,
  priceUsd,
  imageUrl,
}: {
  slug: string;
  merchantNames: string[];
  knownRetailers: string[];
  totalReviews: number;
  ratingDistribution: Record<number, number>;
  priceUsd: number | null;
  imageUrl: string | null;
}) {
  const [result, setResult] = useState<TrustResult | null>(null);

  const load = useCallback(async () => {
    let categoryAverage: number | null = null;
    try {
      const res = await fetch(`/api/v1/products/${slug}/similar?limit=12`);
      const data = await res.json();
      const candidates: SimilarProduct[] = (data?.data ?? []) as SimilarProduct[];
      const cheapestPrices: number[] = [];
      await Promise.all(
        candidates.map(async (c) => {
          try {
            const mRes = await fetch(`/api/v1/products/${c.slug}/merchants`);
            const mData = await mRes.json();
            const listings: MerchantListing[] = (mData?.data ?? []) as MerchantListing[];
            const inStock = listings.filter(
              (l) => l.availability === 'in_stock' || l.inStock === true
            );
            const pool = inStock.length > 0 ? inStock : listings;
            if (pool.length > 0) cheapestPrices.push(Math.min(...pool.map((l) => l.price)));
          } catch {
            // Unpriceable candidates are skipped, never guessed.
          }
        })
      );
      if (cheapestPrices.length >= 2) {
        categoryAverage =
          Math.round(
            (cheapestPrices.reduce((a, b) => a + b, 0) / cheapestPrices.length) * 100
          ) / 100;
      }
    } catch {
      categoryAverage = null;
    }
    setResult(
      analyzeTrust({
        merchantNames,
        knownRetailers,
        totalReviews,
        ratingDistribution,
        priceUsd,
        categoryAverageUsd: categoryAverage,
        imageUrl,
      })
    );
  }, [slug, merchantNames, knownRetailers, totalReviews, ratingDistribution, priceUsd, imageUrl]);

  useEffect(() => {
    load();
  }, [load]);

  const Icon =
    result?.verdict === 'clean' ? ShieldCheck : result?.verdict === 'caution' ? ShieldAlert : ShieldQuestion;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-5 w-5" /> Seller & listing trust check
        </CardTitle>
        <CardDescription>
          Based only on real signals: priced merchants, actual reviews, price vs category average,
          and image presence. This is a caution aid, not a fraud verdict.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!result ? (
          <p className="text-sm text-muted-foreground">Checking listing signals…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={result.verdict === 'clean' ? 'default' : result.verdict === 'caution' ? 'destructive' : 'secondary'}
              >
                {result.verdict === 'clean'
                  ? 'No scam signals detected'
                  : result.verdict === 'caution'
                    ? 'Caution'
                    : 'Insufficient data'}
              </Badge>
              {result.trustScore !== null && (
                <span className="text-sm text-muted-foreground">
                  Trust score {result.trustScore}/100
                </span>
              )}
            </div>
            <p className="text-sm">{result.verdictLabel}</p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {result.signals.map((s) => (
                <li key={s.kind}>
                  <span className="font-medium text-foreground">{s.kind}:</span> {s.detail}
                </li>
              ))}
            </ul>
            {result.trustScore !== null && (
              <p className="text-xs text-muted-foreground">{result.trustScoreFormula}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
