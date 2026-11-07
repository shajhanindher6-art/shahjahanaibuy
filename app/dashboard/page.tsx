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
import { CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useAuth } from '@/features/auth';
import { AISidebar } from '@/components/dashboard/ai-sidebar';
import { AnimatedStat } from '@/components/dashboard/animated-stat';
import { ActiveDealsSection } from '@/components/dashboard/active-deals-section';
import { UpcomingDealsSection } from '@/components/dashboard/upcoming-deals-section';
import {
  DropsToWatchSection,
  type DropToWatch,
} from '@/components/dashboard/drops-to-watch-section';
import { LandedCostWidget } from '@/components/dashboard/landed-cost-widget';

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
  const [drops, setDrops] = useState<DropToWatch[]>([]);
  const [loadingRecs, setLoadingRecs] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [loadingDrops, setLoadingDrops] = useState(true);

  const fetchDashboardData = useCallback(async () => {
    const [recsRes, historyRes, trackingRes, dropsRes] = await Promise.all([
      fetch('/api/v1/recommendations?limit=4').catch(() => null),
      fetch('/api/v1/search-history?limit=5').catch(() => null),
      // Real counts for the overview cards, from the user's own data.
      // On failure the section is hidden — never demo/fallback counts.
      fetch('/api/v1/tracking').catch(() => null),
      // Simulated drop windows for the user's tracked products.
      fetch('/api/v1/dashboard/drops-to-watch').catch(() => null),
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

    try {
      if (dropsRes && dropsRes.ok) {
        const dropsData = await dropsRes.json();
        if (dropsData.success) setDrops(dropsData.data ?? []);
      }
    } catch {
      // Drops section shows its honest empty state.
    } finally {
      setLoadingDrops(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const stats = trackingSummary
    ? [
        {
          icon: Heart,
          label: 'Saved products',
          value: trackingSummary.savedCount,
          subtext: 'Saved products in your wishlists',
          href: '/dashboard/wishlists',
        },
        {
          icon: Bell,
          label: 'Active price alerts',
          value: trackingSummary.activeAlerts,
          subtext: 'Alerts watching for price drops',
          href: '/dashboard/tracking',
        },
        {
          icon: TrendingDown,
          label: 'Price drops',
          value: trackingSummary.priceDrops,
          subtext: 'Price drops on tracked items',
          href: '/dashboard/tracking',
        },
        {
          icon: Tag,
          label: 'Below target',
          value: trackingSummary.belowTarget,
          subtext: 'Items below your target price',
          href: '/dashboard/tracking',
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* AI sidebar — on mobile it stacks below the main content. */}
        <div className="order-2 lg:order-1">
          <AISidebar picks={recommendations} drops={drops} />
        </div>

        <div className="order-1 space-y-6 lg:order-2">
          {/* Glass hero */}
          <div className="glass-card overflow-hidden animate-fade-in motion-reduce:animate-none">
            <div className="relative bg-gradient-to-br from-blue-600 via-violet-600 to-fuchsia-500 p-6 text-white">
              <div className="absolute right-0 top-0 opacity-15">
                <Sparkles className="h-32 w-32" />
              </div>
              <div className="relative">
                <h1 className="text-2xl font-bold">
                  Welcome back, {profile?.fullName?.split(' ')[0] ?? 'Shopper'}!
                </h1>
                <p className="mt-1 text-white/90">
                  Your AI-powered shopping intelligence dashboard
                </p>
                <Badge className="mt-3 capitalize" variant="secondary">
                  {role} Account
                </Badge>
              </div>
            </div>
          </div>

          {/* Activity at a glance — real counts from the user's own data
              (tracking endpoint). Rendered only when the fetch succeeds;
              a failed fetch hides the section instead of showing demo
              numbers. Numbers count up; reduced-motion users see the
              final value immediately. */}
          {trackingSummary && (
            <div>
              <h2 className="mb-4 text-lg font-semibold">Your activity at a glance</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {stats.map((stat, i) => (
                  <div
                    key={stat.label}
                    className="animate-fade-in motion-reduce:animate-none"
                    style={{ animationDelay: `${i * 70}ms` }}
                  >
                    <AnimatedStat {...stat} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <ActiveDealsSection />

          <div className="grid gap-6 lg:grid-cols-2">
            <UpcomingDealsSection />
            <DropsToWatchSection drops={drops} loading={loadingDrops} />
          </div>

          {/* Landed-cost summary for tracked products (Option 12
              delta) — compact, links out to the full calculator on
              each product page. */}
          <LandedCostWidget />

          <div className="animate-fade-in motion-reduce:animate-none" style={{ animationDelay: '340ms' }}>
            <h2 className="mb-4 text-lg font-semibold">Quick Actions</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {quickActions.map((action) => (
                <Link
                  key={action.title}
                  href={action.href}
                  className="glass-card group block p-4 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
                >
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600/15 to-violet-600/15 text-blue-600 transition-colors group-hover:from-blue-600 group-hover:to-violet-600 group-hover:text-white dark:text-blue-400">
                    <action.icon className="h-5 w-5" />
                  </div>
                  <p className="text-base font-semibold">{action.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{action.description}</p>
                </Link>
              ))}
            </div>
          </div>

          <div className="animate-fade-in motion-reduce:animate-none" style={{ animationDelay: '400ms' }}>
            <h2 className="mb-4 text-lg font-semibold">AI Recommendations</h2>
            {loadingRecs ? (
              <div className="flex justify-center py-8"><LoadingSpinner /></div>
            ) : recommendations.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {recommendations.map((rec, i) => (
                  <Link
                    key={rec.productId}
                    href={`/products/${rec.product.slug}`}
                    className="glass-card block p-4 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl animate-fade-in motion-reduce:animate-none"
                    style={{ animationDelay: `${i * 70}ms` }}
                  >
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
                    <div className="mt-2 rounded-md bg-blue-50/80 p-1.5 text-xs text-blue-700 dark:bg-blue-950/80 dark:text-blue-300">
                      {rec.reason}
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="glass-card">
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
              </div>
            )}
          </div>

          <div className="animate-fade-in motion-reduce:animate-none" style={{ animationDelay: '460ms' }}>
            <h2 className="mb-4 text-lg font-semibold">Recent Searches</h2>
            {loadingHistory ? (
              <div className="flex justify-center py-4"><LoadingSpinner size="sm" /></div>
            ) : searchHistory.length > 0 ? (
              <div className="space-y-2">
                {searchHistory.map((entry) => (
                  <div key={entry.id} className="glass-card flex items-center justify-between p-3">
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
                  </div>
                ))}
              </div>
            ) : (
              <div className="glass-card">
                <CardContent className="pt-6">
                  <EmptyState
                    icon={Clock}
                    title="No recent searches"
                    description="Your search history will appear here."
                  />
                </CardContent>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
