'use client';

/**
 * Public shared-wishlist page: /wishlists/[id]
 *
 * This is the page the dashboard's Share button copies a link to.
 * No login is required — anyone with the link can view the wishlist
 * in a clean product grid. The page only ever shows public lists:
 * the API returns 404 for private or missing lists, and this page
 * shows the same "not available" state for both, so private lists
 * cannot be probed.
 *
 * View-only: no editing, no owner information, no private notes.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Check, Gift, Heart, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { ProductCard } from '@/components/products/product-card';
import { computeDealScoreFromPrediction } from '@/lib/deal-score';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';

interface SharedItem {
  product: {
    id: string;
    name: string;
    slug: string;
    brand: string | null;
    category: string | null;
    imageUrl: string | null;
  };
  targetPrice: number | null;
  addedAt: string;
}

interface SharedWishlist {
  id: string;
  name: string;
  description: string | null;
  itemCount: number;
  createdAt: string;
  items: SharedItem[];
  /** S3#11: link to the gift recommender, from the API. */
  giftFinderUrl: string | null;
}

export default function SharedWishlistPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [wishlist, setWishlist] = useState<SharedWishlist | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);

  // Deal Scores per item (same pattern as /search S2#10): the
  // shared-wishlist API returns no prediction data, so scores are
  // fetched client-side per displayed item from
  // GET /api/v1/predictions/[productId] — the same prediction the
  // product page scores from (lib/deal-score.ts). Each product is
  // attempted at most once per page session; a failed or missing
  // prediction simply leaves that card without a badge — never a
  // synthesized score.
  const [dealScores, setDealScores] = useState<Record<string, number>>({});
  const dealScoreAttemptedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!wishlist) return;
    const pending = wishlist.items.filter(
      (item) => !dealScoreAttemptedRef.current.has(item.product.id)
    );
    if (pending.length === 0) return;
    for (const item of pending) dealScoreAttemptedRef.current.add(item.product.id);
    void Promise.all(
      pending.map(async (item) => {
        try {
          const predRes = await fetch(`/api/v1/predictions/${item.product.id}`, {
            signal: AbortSignal.timeout(15000),
          });
          if (!predRes.ok) return;
          const predData = await predRes.json();
          if (!predData.success || !predData.data) return;
          const score = computeDealScoreFromPrediction(predData.data);
          if (score === null) return;
          setDealScores((prev) => ({ ...prev, [item.product.id]: score }));
        } catch {
          // No prediction for this card — no badge, no error.
        }
      })
    );
  }, [wishlist]);

  const fetchShared = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/shared-wishlists/${id}`);
      if (!res.ok) {
        setNotFound(true);
        return;
      }
      const data = await res.json();
      if (data.success && data.data) {
        setWishlist(data.data as SharedWishlist);
      } else {
        setNotFound(true);
      }
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchShared();
  }, [fetchShared]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (e.g. non-secure context): leave the
      // URL in the address bar for the user to copy manually.
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
        {loading ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner size="lg" />
          </div>
        ) : notFound || !wishlist ? (
          <Card>
            <CardContent className="pt-6">
              <EmptyState
                icon={Heart}
                title="This wishlist is not available"
                description="It may be private, or the link may be incorrect."
                action={<Button onClick={() => router.push('/search')}>Browse products</Button>}
              />
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="flex items-center gap-2 text-2xl font-bold">
                  <Heart className="h-7 w-7 text-red-500" /> {wishlist.name}
                </h1>
                {wishlist.description && (
                  <p className="mt-1 text-muted-foreground">{wishlist.description}</p>
                )}
                <p className="mt-1 text-sm text-muted-foreground">
                  {wishlist.itemCount} item{wishlist.itemCount !== 1 ? 's' : ''} · Shared wishlist · No login needed to view
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {/* S3#11: gift-finder link from the API — a visitor
                    viewing someone's wishlist can find a gift from it. */}
                {wishlist.giftFinderUrl && (
                  <Button variant="outline" asChild className="min-h-[44px]">
                    <a href={wishlist.giftFinderUrl}>
                      <Gift className="mr-2 h-4 w-4" /> Find a gift from this list
                    </a>
                  </Button>
                )}
                <Button variant="outline" onClick={copyLink} className="min-h-[44px]">
                  {copied ? (
                    <>
                      <Check className="mr-2 h-4 w-4" /> Copied!
                    </>
                  ) : (
                    <>
                      <Link2 className="mr-2 h-4 w-4" /> Copy link
                    </>
                  )}
                </Button>
              </div>
            </div>

            {wishlist.items.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {wishlist.items.map((item) => (
                  <div key={item.product.id} className="space-y-1">
                    <ProductCard
                      product={{
                        id: item.product.id,
                        name: item.product.name,
                        slug: item.product.slug,
                        brand: item.product.brand,
                        category: item.product.category,
                        imageUrl: item.product.imageUrl,
                        dealScore: dealScores[item.product.id] ?? null,
                      }}
                    />
                    {item.targetPrice !== null && (
                      <p className="px-1 text-xs text-muted-foreground">
                        Target price: ${item.targetPrice.toFixed(2)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="pt-6">
                  <EmptyState
                    icon={Heart}
                    title="This wishlist is empty"
                    description="The owner has not added any products to it yet."
                  />
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
