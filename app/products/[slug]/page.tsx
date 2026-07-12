'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Star, TrendingDown, TrendingUp, Minus,
  Check, X, GitCompare, Bell, Heart, Sparkles, BarChart3,
  ThumbsUp, ThumbsDown, Package
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PriceChart } from '@/components/products/price-chart';
import Image from 'next/image';
import { cn } from '@/lib/utils';

interface Product {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
  gtin: string | null;
  confidenceScore: number;
}

interface AISummary {
  summary: string;
  pros: string[];
  cons: string[];
  alternatives: string[];
}

interface Prediction {
  discountProbability: number;
  expectedSaleDate: string | null;
  expectedLowestPrice: number | null;
  confidenceScore: number;
  explanation: string;
  currentPrice: number | null;
  averagePrice: number | null;
  lowestPrice: number | null;
  highestPrice: number | null;
  price30Day: Array<{ date: string; price: number }>;
  price90Day: Array<{ date: string; price: number }>;
  price1Year: Array<{ date: string; price: number }>;
}

interface Review {
  id: string;
  rating: number;
  title: string | null;
  content: string | null;
  authorName: string | null;
  verifiedPurchase: boolean;
  helpfulCount: number;
  createdAt: string;
}

export default function ProductDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;

  const [product, setProduct] = useState<Product | null>(null);
  const [summary, setSummary] = useState<AISummary | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewSummary, setReviewSummary] = useState<{ avgRating: number; total: number; distribution: Record<number, number> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [productRes, summaryRes, predictionRes, reviewsRes] = await Promise.all([
        fetch(`/api/v1/products/${slug}`),
        fetch(`/api/v1/ai-summary/${slug}`).catch(() => null),
        fetch(`/api/v1/predictions/${slug}`).catch(() => null),
        fetch(`/api/v1/products/${slug}/reviews`).catch(() => null),
      ]);

      const productData = await productRes.json();
      if (!productData.success || !productData.data) {
        setProduct(null);
        return;
      }
      setProduct(productData.data);

      if (summaryRes && summaryRes.ok) {
        const summaryData = await summaryRes.json();
        if (summaryData.success) setSummary(summaryData.data);
      }

      if (predictionRes && predictionRes.ok) {
        const predictionData = await predictionRes.json();
        if (predictionData.success) setPrediction(predictionData.data);
      }

      if (reviewsRes && reviewsRes.ok) {
        const reviewsData = await reviewsRes.json();
        if (reviewsData.success) {
          setReviews(reviewsData.data.reviews ?? []);
          setReviewSummary(reviewsData.data.summary ?? null);
        }
      }

      void fetch(`/api/v1/product-views`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: productData.data.id }),
      }).catch(() => {});
    } catch {
      setProduct(null);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <Package className="h-16 w-16 text-muted-foreground" />
        <h1 className="text-2xl font-bold">Product not found</h1>
        <Button onClick={() => router.push('/search')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Search
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: product.name,
            description: product.description ?? undefined,
            brand: product.brand ? { '@type': 'Brand', name: product.brand } : undefined,
            category: product.category ?? undefined,
            image: product.imageUrl ?? undefined,
            gtin: product.gtin ?? undefined,
            offers: prediction?.currentPrice ? {
              '@type': 'Offer',
              price: prediction.currentPrice,
              priceCurrency: 'USD',
              availability: 'https://schema.org/InStock',
            } : undefined,
            aggregateRating: reviewSummary ? {
              '@type': 'AggregateRating',
              ratingValue: reviewSummary.avgRating,
              reviewCount: reviewSummary.total,
            } : undefined,
          }),
        }}
      />
      <div className="container mx-auto max-w-6xl px-4 py-8">
        <Button variant="ghost" onClick={() => router.back()} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="overflow-hidden">
            <div className="flex h-80 items-center justify-center bg-slate-100 dark:bg-slate-800">
              {product.imageUrl ? (
                <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
              ) : (
                <Package className="h-24 w-24 text-muted-foreground" />
              )}
            </div>
          </Card>

          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2">
                {product.brand && <Badge variant="secondary">{product.brand}</Badge>}
                {product.category && <Badge variant="outline">{product.category}</Badge>}
              </div>
              <h1 className="mt-2 text-2xl font-bold sm:text-3xl">{product.name}</h1>
              {product.description && (
                <p className="mt-2 text-muted-foreground">{product.description}</p>
              )}
            </div>

            {prediction?.currentPrice && (
              <div className="flex items-center gap-3">
                <span className="text-3xl font-bold text-blue-600">
                  ${prediction.currentPrice.toFixed(2)}
                </span>
                {prediction.currentPrice > (prediction.averagePrice ?? 0) && (
                  <Badge className="bg-red-500">
                    <TrendingUp className="mr-1 h-3 w-3" />
                    Above average
                  </Badge>
                )}
                {prediction.currentPrice < (prediction.averagePrice ?? Infinity) && (
                  <Badge className="bg-green-500">
                    <TrendingDown className="mr-1 h-3 w-3" />
                    Below average
                  </Badge>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => router.push(`/compare?products=${product.id}`)}>
                <GitCompare className="mr-2 h-4 w-4" /> Compare
              </Button>
              <Button variant="outline">
                <Bell className="mr-2 h-4 w-4" /> Set Alert
              </Button>
              <Button variant="outline">
                <Heart className="mr-2 h-4 w-4" /> Wishlist
              </Button>
            </div>

            {summary && (
              <Card className="border-blue-200 bg-gradient-to-r from-blue-50 to-cyan-50 dark:border-blue-800 dark:from-blue-950 dark:to-cyan-950">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="h-5 w-5 text-blue-500" />
                    AI Summary
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed">{summary.summary}</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-8">
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-5">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="price-history">Price History</TabsTrigger>
            <TabsTrigger value="prediction">Prediction</TabsTrigger>
            <TabsTrigger value="reviews">Reviews</TabsTrigger>
            <TabsTrigger value="specs">Specs</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4">
            <div className="grid gap-4 md:grid-cols-2">
              {summary && (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <ThumbsUp className="h-5 w-5 text-green-500" />
                        Pros
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {summary.pros.map((pro, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" />
                            {pro}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <ThumbsDown className="h-5 w-5 text-red-500" />
                        Cons
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {summary.cons.map((con, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <X className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
                            {con}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                </>
              )}
              {summary?.alternatives && summary.alternatives.length > 0 && (
                <Card className="md:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-base">Alternatives</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {summary.alternatives.map((alt, i) => (
                        <Button
                          key={i}
                          variant="outline"
                          size="sm"
                          onClick={() => router.push(`/products/${alt}`)}
                        >
                          {alt}
                        </Button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          <TabsContent value="price-history" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BarChart3 className="h-5 w-5 text-blue-500" />
                  Price History
                </CardTitle>
              </CardHeader>
              <CardContent>
                {prediction ? (
                  <>
                    <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                      <StatBox label="Current" value={prediction.currentPrice ? `$${prediction.currentPrice.toFixed(2)}` : '—'} />
                      <StatBox label="Lowest" value={prediction.lowestPrice ? `$${prediction.lowestPrice.toFixed(2)}` : '—'} color="text-green-600" />
                      <StatBox label="Highest" value={prediction.highestPrice ? `$${prediction.highestPrice.toFixed(2)}` : '—'} color="text-red-600" />
                      <StatBox label="Average" value={prediction.averagePrice ? `$${prediction.averagePrice.toFixed(2)}` : '—'} />
                    </div>
                    <PriceChart
                      data30Day={prediction.price30Day}
                      data90Day={prediction.price90Day}
                      data1Year={prediction.price1Year}
                    />
                  </>
                ) : (
                  <p className="text-muted-foreground">No price history available yet.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="prediction" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <TrendingDown className="h-5 w-5 text-purple-500" />
                  Price Drop Prediction
                </CardTitle>
              </CardHeader>
              <CardContent>
                {prediction ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                      <StatBox
                        label="Discount Chance"
                        value={`${Math.round(prediction.discountProbability)}%`}
                        color={prediction.discountProbability > 50 ? 'text-green-600' : 'text-muted-foreground'}
                      />
                      <StatBox
                        label="Expected Sale"
                        value={prediction.expectedSaleDate ?? '—'}
                      />
                      <StatBox
                        label="Expected Low"
                        value={prediction.expectedLowestPrice ? `$${prediction.expectedLowestPrice.toFixed(2)}` : '—'}
                        color="text-green-600"
                      />
                      <StatBox
                        label="Confidence"
                        value={`${Math.round(prediction.confidenceScore)}%`}
                      />
                    </div>
                    <div className="rounded-lg bg-purple-50 p-4 text-sm leading-relaxed dark:bg-purple-950">
                      {prediction.explanation}
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground">No prediction available yet.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="reviews" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Reviews</CardTitle>
                {reviewSummary && (
                  <CardDescription>
                    {reviewSummary.avgRating.toFixed(1)} average from {reviewSummary.total} reviews
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                {reviews.length > 0 ? (
                  <div className="space-y-4">
                    {reviews.map((review) => (
                      <div key={review.id} className="border-b border-slate-100 pb-4 last:border-0 dark:border-slate-800">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{review.authorName ?? 'Anonymous'}</span>
                            {review.verifiedPurchase && (
                              <Badge variant="secondary" className="text-xs">Verified</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <Star
                                key={i}
                                className={cn('h-4 w-4', i < review.rating ? 'fill-yellow-400 text-yellow-400' : 'text-slate-300')}
                              />
                            ))}
                          </div>
                        </div>
                        {review.title && <h4 className="mt-1 font-medium">{review.title}</h4>}
                        {review.content && <p className="mt-1 text-sm text-muted-foreground">{review.content}</p>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground">No reviews yet.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="specs" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Specifications</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:grid-cols-2">
                  <SpecRow label="Brand" value={product.brand} />
                  <SpecRow label="Category" value={product.category} />
                  <SpecRow label="GTIN" value={product.gtin} />
                  <SpecRow label="Confidence Score" value={`${product.confidenceScore}%`} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('mt-1 text-lg font-bold', color)}>{value}</div>
    </div>
  );
}

function SpecRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between border-b border-slate-100 py-2 text-sm dark:border-slate-800">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value ?? '—'}</span>
    </div>
  );
}
