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

interface SmartDealWidgetProps {
  title?: string;
  limit?: number;
  className?: string;
}

export function SmartDealWidget({ title = 'Smart Deals For You', limit = 6, className }: SmartDealWidgetProps) {
  const [deals, setDeals] = useState<SmartDealItem[]>([]);
  const [basedOn, setBasedOn] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // 30s, not 15s: on Netlify Free the first serverless
        // invocation plus the first Supabase queries (cold start)
        // routinely exceed 15s, and the old 15s abort made the
        // widget silently vanish — the visitor saw skeletons and
        // then nothing. Waiting longer is the honest trade-off
        // until the API itself is warmed/cached.
        const res = await fetch(`/api/v1/smart-deals?limit=${limit}`, {
          signal: AbortSignal.timeout(30000),
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
    // Render the section shell (title + skeleton cards) immediately
    // instead of only a spinner: in the live audit the whole section
    // looked absent for ~10s on first load, even though the widget
    // itself was simply waiting on its fetch. Deals fill in when ready.
    return (
      <div className={className}>
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
              <Sparkles className="h-6 w-6 text-primary" />
              {title}
            </h2>
            <p className="mt-2 text-muted-foreground">
              Trending deals ranked by discount and popularity. Sign in for picks tuned to you.
            </p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: limit }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-lg border p-4">
              <div className="mb-3 h-32 rounded-lg bg-slate-100 dark:bg-slate-800" />
              <div className="h-4 w-1/2 rounded bg-slate-100 dark:bg-slate-800" />
              <div className="mt-2 h-3 w-3/4 rounded bg-slate-100 dark:bg-slate-800" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (deals.length === 0) {
    // Never silently vanish: the live audit saw skeletons and then
    // an empty homepage section, with no way for the visitor to
    // reach the deals that DO exist on /deals. A failed or empty
    // widget now says so and links to /deals instead of returning
    // null and looking like a broken page section.
    return (
      <div className={className}>
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
              <Sparkles className="h-6 w-6 text-primary" />
              {title}
            </h2>
            <p className="mt-2 text-muted-foreground">
              Deals couldn&apos;t be loaded right now — browse all deals instead.
            </p>
          </div>
          <Button variant="outline" asChild className="shrink-0">
            <Link href="/deals">
              All Deals <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    );
  }

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
                  {deal.product!.imageUrl && !failedImages.has(deal.product!.id) ? (
                    <img
                      src={deal.product!.imageUrl}
                      alt={deal.product!.name}
                      className="h-full w-full object-cover"
                      onError={() =>
                        setFailedImages((prev) => new Set(prev).add(deal.product!.id))
                      }
                    />
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
                {deal.currentPrice !== null && deal.currentPrice !== undefined ? (
                  <p className="mt-1 text-base font-bold text-blue-600">
                    ${deal.currentPrice.toFixed(2)}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">Price not listed</p>
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
