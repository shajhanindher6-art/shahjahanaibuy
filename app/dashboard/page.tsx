'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Brain,
  TrendingDown,
  Search,
  Bell,
  ArrowRight,
  Sparkles,
  GitCompare,
  Tag,
  Heart,
  Clock,
  Archive,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useAuth } from '@/features/auth';

interface QuickAction {
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  badge?: string;
}

const quickActions: QuickAction[] = [
  {
    icon: Search,
    title: 'AI Search',
    description: 'Find products with natural language search',
    href: '/search',
  },
  {
    icon: GitCompare,
    title: 'Compare Products',
    description: 'Compare products across retailers with AI insights',
    href: '/compare',
  },
  {
    icon: Tag,
    title: 'Smart Deals',
    description: 'AI-ranked deals, flash sales, and coupons',
    href: '/deals',
  },
  {
    icon: Brain,
    title: 'Recommendations',
    description: 'Personalized suggestions based on your activity',
    href: '/dashboard/recommendations',
  },
  {
    icon: Archive,
    title: 'Receipt Vault',
    description: 'Save purchases and track warranty expiry',
    href: '/dashboard/vault',
  },
];

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

interface SearchHistoryEntry {
  id: string;
  query: string;
  resultsCount: number;
  createdAt: string;
}

interface TrackingSummary {
  savedCount: number;
  activeAlerts: number;
  priceDrops: number;
  belowTarget: number;
}

export default function DashboardPage() {
  const { profile, role } = useAuth();
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryEntry[]>([]);
  const [trackingSummary, setTrackingSummary] = useState<TrackingSummary | null>(null);
  const [loadingRecs, setLoadingRecs] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const fetchDashboardData = useCallback(async () => {
    const [recsRes, historyRes, trackingRes] = await Promise.all([
      fetch('/api/v1/recommendations?limit=4').catch(() => null),
      fetch('/api/v1/search-history?limit=5').catch(() => null),
      // Real counts for the overview cards, from the user's own data.
      // On failure the section is hidden — never demo/fallback counts.
      fetch('/api/v1/tracking').catch(() => null),
    ]);

    try {
      if (recsRes && recsRes.ok) {
        const recsData = await recsRes.json();
        if (recsData.success) setRecommendations(recsData.data ?? []);
      }
    } catch {
      // Not logged in or error
    } finally {
      setLoadingRecs(false);
    }

    try {
      if (historyRes && historyRes.ok) {
        const historyData = await historyRes.json();
        if (historyData.success) setSearchHistory(historyData.data ?? []);
      }
    } catch {
      // Not logged in or error
    } finally {
      setLoadingHistory(false);
    }

    try {
      if (trackingRes && trackingRes.ok) {
        const trackingData = await trackingRes.json();
        if (trackingData.success && trackingData.data?.summary) {
          setTrackingSummary(trackingData.data.summary as TrackingSummary);
        }
      }
    } catch {
      // Overview cards stay hidden; other sections still render.
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <div className="relative bg-gradient-to-br from-primary to-chart-4 p-6 text-primary-foreground">
          <div className="absolute right-0 top-0 opacity-10">
            <Sparkles className="h-32 w-32" />
          </div>
          <div className="relative">
            <h1 className="text-2xl font-bold">
              Welcome back, {profile?.fullName?.split(' ')[0] ?? 'Shopper'}!
            </h1>
            <p className="mt-1 text-primary-foreground/90">
              Your AI-powered shopping intelligence dashboard
            </p>
            <Badge className="mt-3 capitalize" variant="secondary">
              {role} Account
            </Badge>
          </div>
        </div>
      </Card>

      {/* Activity at a glance — real counts from the user's own data
          (tracking endpoint). Rendered only when the fetch succeeds;
          a failed fetch hides the section instead of showing demo
          numbers. Links point at the existing sections; this is not a
          second dashboard. */}
      {trackingSummary && (
        <div>
          <h2 className="mb-4 text-lg font-semibold">Your activity at a glance</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="transition-shadow hover:shadow-md">
              <Link href="/dashboard/wishlists">
                <CardHeader>
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Heart className="h-5 w-5" />
                  </div>
                  <CardTitle className="text-2xl">{trackingSummary.savedCount}</CardTitle>
                  <CardDescription className="text-xs">Saved products in your wishlists</CardDescription>
                </CardHeader>
              </Link>
            </Card>
            <Card className="transition-shadow hover:shadow-md">
              <Link href="/dashboard/tracking">
                <CardHeader>
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Bell className="h-5 w-5" />
                  </div>
                  <CardTitle className="text-2xl">{trackingSummary.activeAlerts}</CardTitle>
                  <CardDescription className="text-xs">Active price alerts</CardDescription>
                </CardHeader>
              </Link>
            </Card>
            <Card className="transition-shadow hover:shadow-md">
              <Link href="/dashboard/tracking">
                <CardHeader>
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <TrendingDown className="h-5 w-5" />
                  </div>
                  <CardTitle className="text-2xl">{trackingSummary.priceDrops}</CardTitle>
                  <CardDescription className="text-xs">Price drops on tracked items</CardDescription>
                </CardHeader>
              </Link>
            </Card>
            <Card className="transition-shadow hover:shadow-md">
              <Link href="/dashboard/tracking">
                <CardHeader>
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Tag className="h-5 w-5" />
                  </div>
                  <CardTitle className="text-2xl">{trackingSummary.belowTarget}</CardTitle>
                  <CardDescription className="text-xs">Items below your target price</CardDescription>
                </CardHeader>
              </Link>
            </Card>
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-4 text-lg font-semibold">Quick Actions</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {quickActions.map((action) => (
            <Card
              key={action.title}
              className="group cursor-pointer transition-shadow hover:shadow-md"
            >
              <Link href={action.href}>
                <CardHeader>
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                    <action.icon className="h-5 w-5" />
                  </div>
                  <CardTitle className="text-base">{action.title}</CardTitle>
                  <CardDescription className="text-xs">{action.description}</CardDescription>
                </CardHeader>
              </Link>
            </Card>
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-4 text-lg font-semibold">AI Recommendations</h2>
        {loadingRecs ? (
          <div className="flex justify-center py-8"><LoadingSpinner /></div>
        ) : recommendations.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {recommendations.map((rec) => (
              <Card key={rec.productId} className="cursor-pointer transition-shadow hover:shadow-md">
                <Link href={`/products/${rec.product.slug}`}>
                  <CardContent className="p-4">
                    <div className="mb-2 h-32 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                      {rec.product.imageUrl ? (
                        <img src={rec.product.imageUrl} alt={rec.product.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          <Brain className="h-8 w-8 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <h3 className="font-medium text-sm leading-tight">{rec.product.name}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{rec.product.brand}</p>
                    <div className="mt-2 rounded-md bg-blue-50 p-1.5 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                      {rec.reason}
                    </div>
                  </CardContent>
                </Link>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="pt-6">
              <EmptyState
                icon={Brain}
                title="No recommendations yet"
                description="Search for products, add items to your wishlist, and browse deals to get personalized recommendations."
                action={
                  <Button asChild size="sm">
                    <Link href="/search">
                      Start Searching <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                }
              />
            </CardContent>
          </Card>
        )}
      </div>

      <div>
        <h2 className="mb-4 text-lg font-semibold">Recent Searches</h2>
        {loadingHistory ? (
          <div className="flex justify-center py-4"><LoadingSpinner size="sm" /></div>
        ) : searchHistory.length > 0 ? (
          <div className="space-y-2">
            {searchHistory.map((entry) => (
              <Card key={entry.id}>
                <CardContent className="flex items-center justify-between p-3">
                  <div className="flex items-center gap-3">
                    <Search className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{entry.query}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="secondary">{entry.resultsCount} results</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="pt-6">
              <EmptyState
                icon={Clock}
                title="No recent searches"
                description="Your search history will appear here."
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
