'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Brain, Sparkles, ArrowRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TransparencyBlock } from '@/components/ai/transparency-block';
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
  priceUsd?: number | null;
  overBudgetByUsd?: number | null;
}

interface SavedRecommendation {
  productId: string;
  name: string;
  slug: string;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
  addedAt: string;
}

export default function RecommendationsPage() {
  const router = useRouter();
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [saved, setSaved] = useState<SavedRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [basedOn, setBasedOn] = useState('');
  const [personalizationOptOut, setPersonalizationOptOut] = useState(false);
  const [feedbackNote, setFeedbackNote] = useState<string | null>(null);

  const fetchRecommendations = useCallback(async () => {
    setLoading(true);
    try {
      const [recRes, savedRes] = await Promise.all([
        fetch('/api/v1/recommendations?limit=20'),
        fetch('/api/v1/recommendations/saved'),
      ]);
      const data = await recRes.json();
      if (data.success) {
        setRecommendations(data.data ?? []);
        setBasedOn(data.meta?.basedOn ?? 'trending');
        setPersonalizationOptOut(data.meta?.personalizationOptOut === true);
      }
      const savedData = await savedRes.json();
      if (savedData.success) setSaved(savedData.data ?? []);
    } catch {
      setRecommendations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecommendations();
  }, [fetchRecommendations]);

  // Section 19, Phase 4 (§12 #41/#42) — save = thumbs-up (stored
  // in the "Saved recommendations" list); dismiss = thumbs-down
  // (the product is never recommended again). Both refresh the
  // list so the effect is visible immediately.
  async function saveOne(productId: string) {
    setFeedbackNote(null);
    const res = await fetch('/api/v1/recommendations/saved', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId }),
    });
    if (res.ok) {
      setFeedbackNote('Saved — find it below and in your wishlists.');
      await fetchRecommendations();
    } else {
      setFeedbackNote('Could not save this recommendation yet.');
    }
  }

  async function dismissOne(productId: string) {
    setFeedbackNote(null);
    const res = await fetch('/api/v1/recommendations/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, feedback: 'dismissed' }),
    });
    if (res.ok) {
      setFeedbackNote('Dismissed — it will not be recommended to you again.');
      await fetchRecommendations();
    } else {
      setFeedbackNote('Could not dismiss this recommendation yet.');
    }
  }

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
          {personalizationOptOut
            ? 'Personalisation is off for your account — showing trending products only. Change this in Settings.'
            : `Personalized suggestions based on ${basedOnLabel[basedOn] ?? 'your activity'}`}
        </p>
        {feedbackNote && (
          <p className="mt-2 text-sm text-muted-foreground" role="status">
            {feedbackNote}
          </p>
        )}
      </div>

      {/* Section 19, fix-up (§12 #70): shared transparency block —
          what the relevance score is, what signals were read, and
          what the engine never uses. Fed only from this page's own
          data (the API's basedOn + opt-out flag and the rule-score
          formula in services/ai-recommendations.ts); the API
          returns no generation timestamp, so the block says so
          instead of inventing one. */}
      {!loading && recommendations.length > 0 && (
        <TransparencyBlock
          title="How these recommendations were picked"
          dataUsed={[
            `Strongest signal: ${basedOnLabel[basedOn] ?? 'Trending Products'}.`,
            personalizationOptOut
              ? 'Personalisation is off, so no personal signal was read at all — these are trending products only.'
              : 'Signals read: your search history, wishlist, products you viewed, and your saved preferences (favourite brands and categories).',
            'Relevance score: starts at 50, +20 for a matching favourite brand, +15 for a matching category, +15 when the recorded price is within your set budget.',
            'Prices are the lowest recorded in-stock merchant prices; a product with no recorded price carries no budget claim either way.',
          ]}
          dataTimestamp={null}
          dataTimestampLabel="Recommendations generated at"
          confidence="The relevance score (0–100) is a rule score — brand, category and budget matches added up. It is not a measured match rate and not a prediction that you will like the product."
          assumptions={[
            'A brand or category match is treated as interest in that brand or category.',
            'When nothing fits your budget, over-budget products are still shown — each labelled with how far over budget it is.',
          ]}
          missingInfo={[
            'No review data, no specification data and no purchase history are used.',
            'Search history only recognises 8 keywords (laptop, phone, camera, watch, headphones, tablet, tv, gaming) — other search terms contribute nothing.',
            'Your budget is only a signal when you set one in your preferences.',
          ]}
        />
      )}

      {saved.length > 0 && (
        <section aria-label="Saved recommendations">
          <h2 className="text-lg font-semibold">Saved recommendations</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {saved.map((item) => (
              <Card
                key={item.productId}
                className="cursor-pointer transition-shadow hover:shadow-lg"
                onClick={() => router.push(`/products/${item.slug}`)}
              >
                <CardContent className="p-4">
                  <div className="mb-3 h-40 overflow-hidden rounded-lg bg-muted">
                    {item.imageUrl ? (
                      <Image src={item.imageUrl} alt={item.name} width={480} height={320} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <Sparkles className="h-10 w-10 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <h3 className="font-medium leading-tight">{item.name}</h3>
                  {item.brand && <p className="text-sm text-muted-foreground">{item.brand}</p>}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Saved from a recommendation — also in your wishlists under “Saved recommendations”.
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

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
                <div className="mb-3 h-40 overflow-hidden rounded-lg bg-muted">
                  {rec.product.imageUrl ? (
                    <Image src={rec.product.imageUrl} alt={rec.product.name} width={480} height={320} className="h-full w-full object-cover" />
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
                  {/* Section 19, fix-up (§12 #74): the old badge read
                      "{score}% match" — a rule score presented as a
                      measured match rate. The score starts at 50 and
                      adds 20 for a matching favourite brand, 15 for
                      a matching category and 15 when the price is
                      within the user's set budget (see
                      services/ai-recommendations.ts buildRecommendation),
                      so it is a relevance score, not a match rate. */}
                  <Badge
                    className="bg-blue-600"
                    title="Relevance score: brand, category and budget matches added up (starts at 50) — not a measured match rate"
                  >
                    Relevance {Math.round(rec.score)}/100
                  </Badge>
                </div>
                <div className="mt-2 rounded-md bg-blue-50 p-2 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                  {rec.reason}
                </div>
                {rec.priceUsd !== null && rec.priceUsd !== undefined && (
                  <p className="mt-2 text-sm font-medium">
                    ${rec.priceUsd.toFixed(2)}
                    {rec.overBudgetByUsd !== null && rec.overBudgetByUsd !== undefined && (
                      <span className="ml-2 text-xs font-normal text-red-600">
                        ${rec.overBudgetByUsd.toFixed(2)} over your budget
                      </span>
                    )}
                  </p>
                )}
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      void saveOne(rec.productId);
                    }}
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="flex-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      void dismissOne(rec.productId);
                    }}
                  >
                    Not interested
                  </Button>
                </div>
                <Button size="sm" variant="outline" className="mt-2 w-full">
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
