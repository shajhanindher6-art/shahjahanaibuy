'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Brain, Sparkles, ArrowRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';

interface Recommendation {
  productId: string;
  product: {
    id: string;
    name: string;
    slug: string;
    brand: string | null;
    category: string | null;
    imageUrl: string | null;
  };
  score: number;
  reason: string;
}

export default function RecommendationsPage() {
  const router = useRouter();
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [basedOn, setBasedOn] = useState('');

  const fetchRecommendations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/recommendations?limit=20');
      const data = await res.json();
      if (data.success) {
        setRecommendations(data.data ?? []);
        setBasedOn(data.meta?.basedOn ?? 'trending');
      }
    } catch {
      setRecommendations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecommendations();
  }, [fetchRecommendations]);

  const basedOnLabel: Record<string, string> = {
    search_history: 'Your Search History',
    wishlist: 'Your Wishlist',
    views: 'Products You\'ve Viewed',
    preferences: 'Your Preferences',
    trending: 'Trending Products',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Brain className="h-7 w-7 text-blue-600" />
          AI Recommendations
        </h1>
        <p className="mt-1 text-muted-foreground">
          Personalized suggestions based on {basedOnLabel[basedOn] ?? 'your activity'}
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
      ) : recommendations.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {recommendations.map((rec) => (
            <Card
              key={rec.productId}
              className="cursor-pointer transition-shadow hover:shadow-lg"
              onClick={() => router.push(`/products/${rec.product.slug}`)}
            >
              <CardContent className="p-4">
                <div className="mb-3 h-40 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                  {rec.product.imageUrl ? (
                    <img src={rec.product.imageUrl} alt={rec.product.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <Sparkles className="h-10 w-10 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-medium leading-tight">{rec.product.name}</h3>
                    {rec.product.brand && <p className="text-sm text-muted-foreground">{rec.product.brand}</p>}
                  </div>
                  <Badge className="bg-blue-600">{Math.round(rec.score)}% match</Badge>
                </div>
                <div className="mt-2 rounded-md bg-blue-50 p-2 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                  {rec.reason}
                </div>
                <Button size="sm" variant="outline" className="mt-3 w-full">
                  View Product <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={Brain}
              title="No recommendations yet"
              description="Search for products, add items to your wishlist, and browse to get personalized recommendations."
              action={
                <Button onClick={() => router.push('/search')}>
                  Start Searching <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              }
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
