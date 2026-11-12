/**
 * Active Deals section — AI Glass dashboard.
 *
 * Real active deals, two sources joined by product:
 * - GET /api/v1/smart-deals?limit=6 — product, discount, current
 *   price, reason (ranked deals).
 * - GET /api/v1/deals?pageSize=20 — the deals table rows, for the
 *   real end_at countdown per product.
 * The countdown ("Ends in 3d 4h") comes only from end_at; a deal
 * with no matching table row simply shows no countdown — never a
 * guessed date. On failure the section shows an honest empty state
 * with a link to /deals, never demo deals.
 */

'use client';

import { useRegion } from '@/components/region/region-provider';
import { tFor } from '@/lib/i18n';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Tag, ArrowRight, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Price } from '@/components/region/price';
import { formatDealCountdown } from '@/services/dashboard-helpers';

interface SmartDealItem {
  dealId: string | null;
  productId: string | null;
  product: {
    id: string;
    name: string;
    slug: string;
    brand: string | null;
    category: string | null;
    imageUrl: string | null;
  } | null;
  discountPercentage: number;
  savingsAmount: number;
  currentPrice: number | null;
  reason: string;
  isFeatured: boolean;
  couponCode: string | null;
}

interface DealRow {
  productId: string;
  endAt: string;
}

export function ActiveDealsSection() {
  const { language } = useRegion();
  const [deals, setDeals] = useState<SmartDealItem[]>([]);
  const [endAtByProduct, setEndAtByProduct] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [smartRes, dealsRes] = await Promise.all([
          fetch('/api/v1/smart-deals?limit=6').catch(() => null),
          fetch('/api/v1/deals?pageSize=20').catch(() => null),
        ]);
        if (cancelled) return;
        if (smartRes && smartRes.ok) {
          const data = await smartRes.json();
          if (data.success) setDeals((data.data ?? []).filter((d: SmartDealItem) => d.product));
        }
        if (dealsRes && dealsRes.ok) {
          const data = await dealsRes.json();
          const map = new Map<string, string>();
          for (const row of (data.data ?? []) as DealRow[]) {
            if (row.productId && row.endAt && !map.has(row.productId)) {
              map.set(row.productId, row.endAt);
            }
          }
          setEndAtByProduct(map);
        }
      } catch {
        // Empty state below.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="animate-fade-in motion-reduce:animate-none" style={{ animationDelay: '120ms' }}>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Tag className="h-5 w-5 text-blue-600" /> Active deals
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Live deals with real discounts — countdowns use each deal&apos;s actual end date.
          </p>
        </div>
        <Button variant="outline" asChild size="sm" className="shrink-0">
          <Link href="/deals">
            All Deals <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass-card animate-shimmer h-40" />
          ))}
        </div>
      ) : deals.length === 0 ? (
        <div className="glass-card p-6 text-center">
          <p className="text-sm text-muted-foreground">No active deals right now — check back soon.</p>
          <Button asChild size="sm" className="mt-3">
            <Link href="/deals">Browse all deals</Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {deals.map((deal) => {
            const endAt = deal.productId ? endAtByProduct.get(deal.productId) : undefined;
            return (
              <Link
                key={deal.dealId ?? deal.product!.id}
                href={`/products/${deal.product!.slug}`}
                className="glass-card group block p-4 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
              >
                <div className="flex flex-wrap gap-2">
                  {deal.discountPercentage > 0 && (
                    <Badge>{Math.round(deal.discountPercentage)}% off</Badge>
                  )}
                  {endAt && (
                    <Badge variant="secondary" className="gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDealCountdown(endAt)}
                    </Badge>
                  )}
                  {deal.couponCode && <Badge variant="outline">Code: {deal.couponCode}</Badge>}
                </div>
                <h3 className="mt-2 text-sm font-medium leading-tight">{deal.product!.name}</h3>
                {deal.product!.brand && (
                  <p className="mt-1 text-xs text-muted-foreground">{deal.product!.brand}</p>
                )}
                {deal.currentPrice !== null && deal.currentPrice !== undefined ? (
                  <p className="mt-1 text-base font-bold text-blue-600">
                    <Price usd={deal.currentPrice} />
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">{tFor(language, 'commonPriceNotListed')}</p>
                )}
                <p className="mt-2 rounded-md bg-blue-50/80 p-1.5 text-xs text-blue-700 dark:bg-blue-950/80 dark:text-blue-300">
                  {deal.reason}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
