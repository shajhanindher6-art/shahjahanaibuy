'use client';

import { useState, useEffect, useCallback } from 'react';
import { Brain, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { ProductCard, type ProductCardData } from '@/components/products/product-card';
import { computeDealScoreFromPrediction } from '@/lib/deal-score';

interface SimilarProductsProps {
  productId: string;
  productSlug: string;
  category?: string | null;
  brand?: string | null;
}

export function SimilarProducts({ productId, productSlug, category, brand }: SimilarProductsProps) {
  const [products, setProducts] = useState<ProductCardData[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSimilar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/products/${productSlug}/similar?limit=4`);
      const data = await res.json();
      if (data.success) {
        const items = (data.data ?? []) as ProductCardData[];
        setProducts(items);
        // S2#10: attach the canonical Deal Score (lib/deal-score.ts)
        // to each card, from GET /api/v1/predictions/[slug] — the
        // same prediction the product page scores from. One fetch per
        // card (max 4), in parallel, 15s timeout; a failed or
        // missing prediction leaves dealScore null and the card
        // simply shows no badge (its Match chip instead) — never a
        // synthesized score. The similar API's matchScore is a
        // similarity signal, not a Deal Score, and is never passed
        // through this badge (see ProductCard).
        void Promise.all(
          items.map(async (item) => {
            try {
              const predRes = await fetch(`/api/v1/predictions/${item.slug}`, {
                signal: AbortSignal.timeout(15000),
              });
              if (!predRes.ok) return;
              const predData = await predRes.json();
              if (!predData.success || !predData.data) return;
              const score = computeDealScoreFromPrediction(predData.data);
              if (score === null) return;
              setProducts((prev) =>
                prev.map((p) => (p.id === item.id ? { ...p, dealScore: score } : p))
              );
            } catch {
              // No prediction for this card — no badge, no error.
            }
          })
        );
      } else {
        setProducts([]);
      }
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [productSlug]);

  useEffect(() => {
    fetchSimilar();
  }, [fetchSimilar]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Brain className="h-5 w-5 text-blue-500" />
              Similar Products
            </CardTitle>
            <CardDescription className="mt-1">
              AI-curated alternatives in {category ?? 'this category'}
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={fetchSimilar} disabled={loading}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8">
            <LoadingSpinner />
          </div>
        ) : products.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} showReason />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Brain}
            title="No similar products found"
            description="We couldn't find similar products at this time."
          />
        )}
      </CardContent>
    </Card>
  );
}
