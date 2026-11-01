/**
 * Smart Deal Recommendation Widget — embeddable deal suggestions.
 *
 * Fetches GET /api/v1/smart-deals (public for guests, personalized
 * when signed in) and renders the top deals as product cards with
 * the discount, the reason for the suggestion, and a link to the
 * product page. It renders nothing but a loading state on failure —
 * a failed widget must never break the page that embeds it.
 *
 * Usage: <SmartDealWidget title="Smart Deals For You" limit={6} />
 * Currently mounted on the homepage (app/page.tsx); it can be dropped
 * into any other page the same way.
 */

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Sparkles, Tag, ArrowRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';

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
  reason: string;
  isFeatured: boolean;
  couponCode: string | null;
}

interface SmartDealWidgetProps {
  title?: string;
  limit?: number;
  className?: string;
}

export function SmartDealWidget({ title = 'Smart Deals For You', limit = 6, className }: SmartDealWidgetProps) {
  const [deals, setDeals] = useState<SmartDealItem[]>([]);
  const [basedOn, setBasedOn] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/v1/smart-deals?limit=${limit}`, {
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error('smart-deals request failed');
        const data = await res.json();
        if (!cancelled && data.success) {
          setDeals((data.data ?? []).filter((d: SmartDealItem) => d.product));
          setBasedOn(data.meta?.basedOn ?? null);
        }
      } catch {
        if (!cancelled) setDeals([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [limit]);

  if (loading) {
    return (
      <div className={className}>
        <div className="flex justify-center py-8">
          <LoadingSpinner />
        </div>
      </div>
    );
  }

  if (deals.length === 0) return null;

  return (
    <div className={className}>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
            <Sparkles className="h-6 w-6 text-primary" />
            {title}
          </h2>
          <p className="mt-2 text-muted-foreground">
            {basedOn === 'personalized'
              ? 'Picked from trending deals, tuned to your recent activity.'
              : 'Trending deals ranked by discount and popularity. Sign in for picks tuned to you.'}
          </p>
        </div>
        <Button variant="outline" asChild className="shrink-0">
          <Link href="/deals">
            All Deals <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {deals.map((deal) => (
          <Card key={deal.dealId ?? deal.product!.id} className="transition-shadow hover:shadow-md">
            <Link href={`/products/${deal.product!.slug}`}>
              <CardContent className="p-4">
                <div className="mb-3 h-32 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                  {deal.product!.imageUrl ? (
                    <img src={deal.product!.imageUrl} alt={deal.product!.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <Tag className="h-8 w-8 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {deal.discountPercentage > 0 && (
                    <Badge variant="default">{Math.round(deal.discountPercentage)}% off</Badge>
                  )}
                  {deal.isFeatured && <Badge variant="secondary">Featured</Badge>}
                  {deal.couponCode && <Badge variant="outline">Code: {deal.couponCode}</Badge>}
                </div>
                <h3 className="mt-2 text-sm font-medium leading-tight">{deal.product!.name}</h3>
                {deal.product!.brand && (
                  <p className="mt-1 text-xs text-muted-foreground">{deal.product!.brand}</p>
                )}
                <p className="mt-2 rounded-md bg-blue-50 p-1.5 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                  {deal.reason}
                </p>
              </CardContent>
            </Link>
          </Card>
        ))}
      </div>
    </div>
  );
}
