'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
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
  X,
  Mail,
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
import { TechBudgetWidget } from '@/components/dashboard/tech-budget-widget';
import { BuyListPanel } from '@/components/dashboard/buy-list-panel';
import { PriceProtectionPanel } from '@/components/dashboard/price-protection-panel';
import { SavingsWidget } from '@/components/dashboard/savings-widget';
import { AgentHuntsCard } from '@/components/dashboard/agent-hunts-card';
import type { BuyListItemView } from '@/lib/buy-list';
import type { ProtectionWatchView } from '@/lib/price-protection';
import type { SaverBadge } from '@/lib/savings';
import {
  readGuestMergeResult,
  clearGuestMergeResult,
  formatGuestMergeSummary,
} from '@/lib/guest-merge';
import { DigestGrid } from '@/components/dashboard/digest-grid';
import { AccuracyDashboard } from '@/components/accuracy/accuracy-dashboard';
import { DashboardCardsSkeleton } from '@/components/ui/skeleton';
// Section 13, Chunk F — dashboard depth cards. The watched-price
// summary, lists glance, alert health, activity feed and checklist
// all read the tracking / search-history / savings fetches this
// page already makes (passed down as props, no extra fetches);
// the referral and digest-snapshot cards fetch their own
// endpoints, and the savings history lists the events the
// savings fetch already returns.
import { WatchedPriceSummary, type WatchedPriceItem } from '@/components/dashboard/watched-price-summary';
import { ListsAtAGlance } from '@/components/dashboard/lists-at-a-glance';
import { AlertHealth, type AlertHealthAlert } from '@/components/dashboard/alert-health';
import {
  RecentActivityFeed,
  type ActivityAlertHistoryEntry,
  type ActivitySearchEntry,
} from '@/components/dashboard/recent-activity-feed';
import { SavingsHistory } from '@/components/dashboard/savings-history';
import { ReferralCard } from '@/components/dashboard/referral-card';
import { GettingStartedChecklist } from '@/components/dashboard/getting-started-checklist';
import { DigestSnapshotCard } from '@/components/dashboard/digest-snapshot-card';
import { DigestArchive } from '@/components/dashboard/digest-archive';
import { SavedSearches } from '@/components/search/saved-searches';
import { PushOptInPrompt } from '@/components/home/push-opt-in-prompt';
import type { SavingsEvent } from '@/lib/savings';
import type { AccuracySummary } from '@/lib/prediction-accuracy';

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
  {
    icon: Mail,
    title: 'Price-Drop Digest',
    description: 'Your weekly digest of drops on watched products',
    href: '/tools/price-drop-digest',
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

// Section 13, Chunk F — the dashboard discards everything the
// tracking endpoint returns except the summary; keep the items
// and alerts too, so the depth cards below can use them without
// a second fetch.
interface TrackingItem extends WatchedPriceItem {
  itemId: string;
  wishlistId: string;
  wishlistName: string;
  addedAt: string;
}

interface TrackingAlert extends AlertHealthAlert {
  productId: string;
  productName: string;
  productSlug: string | null;
  alertType: string;
  conditionValue: number | null;
  channel: string;
  createdAt: string;
}

export default function DashboardPage() {
  const { profile, role } = useAuth();
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryEntry[]>([]);
  const [trackingSummary, setTrackingSummary] = useState<TrackingSummary | null>(null);
  // Section 13, Chunk F — full tracking payload + alert history +
  // savings events, kept for the depth cards (no extra fetches).
  const [trackingItems, setTrackingItems] = useState<TrackingItem[]>([]);
  const [trackingAlerts, setTrackingAlerts] = useState<TrackingAlert[]>([]);
  const [alertHistory, setAlertHistory] = useState<ActivityAlertHistoryEntry[]>([]);
  const [savingsEvents, setSavingsEvents] = useState<SavingsEvent[]>([]);
  const [drops, setDrops] = useState<DropToWatch[]>([]);
  const [loadingRecs, setLoadingRecs] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [loadingDrops, setLoadingDrops] = useState(true);
  // S4#8 accuracy summary + S4#2 stat-card skeleton state. The
  // accuracy fetch is independent: a failure hides the section,
  // never a guessed percentage.
  const [accuracy, setAccuracy] = useState<AccuracySummary | null>(null);
  const [loadingTracking, setLoadingTracking] = useState(true);
  // Section 6: buy-list shortlist, price-protection watches, and the
  // savings ledger. Each fetch fails independently — a failed section
  // hides or shows its honest empty state, never a guessed figure.
  const [buyListItems, setBuyListItems] = useState<BuyListItemView[]>([]);
  const [loadingBuyList, setLoadingBuyList] = useState(true);
  const [protectionWatches, setProtectionWatches] = useState<ProtectionWatchView[]>([]);
  const [loadingProtection, setLoadingProtection] = useState(true);
  const [savings, setSavings] = useState<{
    totalSavedUsd: number;
    eventCount: number;
    streakWeeks: number;
    badge: SaverBadge;
  } | null>(null);
  const [loadingSavings, setLoadingSavings] = useState(true);

  // Section 12, Chunk B — guest → signed-in merge note: the merge
  // runner (AuthProvider → lib/guest-merge.ts) stores its confirmed
  // result in sessionStorage; this reads it once, shows exactly what
  // was carried over (never a claim about a category that did not
  // merge), and clears it so the note does not repeat. Nothing
  // renders when there was no merge.
  const [mergeNote, setMergeNote] = useState<string | null>(null);
  useEffect(() => {
    const result = readGuestMergeResult();
    if (!result) return;
    clearGuestMergeResult();
    setMergeNote(formatGuestMergeSummary(result));
  }, []);

  const fetchDashboardData = useCallback(async () => {
    const [recsRes, historyRes, trackingRes, dropsRes, accuracyRes, buyListRes, protectionRes, savingsRes, alertHistoryRes] = await Promise.all([
      fetch('/api/v1/recommendations?limit=4').catch(() => null),
      fetch('/api/v1/search-history?limit=5').catch(() => null),
      // Real counts for the overview cards, from the user's own data.
      // On failure the section is hidden — never demo/fallback counts.
      fetch('/api/v1/tracking').catch(() => null),
      // Simulated drop windows for the user's tracked products.
      fetch('/api/v1/dashboard/drops-to-watch').catch(() => null),
      // Public prediction-accuracy summary (S4#8).
      fetch('/api/v1/predictions/accuracy').catch(() => null),
      // Section 6: buy-list shortlist, protection watches, savings.
      fetch('/api/v1/buy-list').catch(() => null),
      fetch('/api/v1/price-protection').catch(() => null),
      fetch('/api/v1/savings').catch(() => null),
      // Section 13, Chunk F: alert trigger history for the
      // recent-activity feed.
      fetch('/api/v1/alerts/history?limit=20').catch(() => null),
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
        // Section 13, Chunk F — keep the items and alerts for the
        // watched-price summary, lists glance, alert health, and
        // activity feed.
        if (trackingData.success && Array.isArray(trackingData.data?.items)) {
          setTrackingItems(trackingData.data.items as TrackingItem[]);
        }
        if (trackingData.success && Array.isArray(trackingData.data?.alerts)) {
          setTrackingAlerts(trackingData.data.alerts as TrackingAlert[]);
        }
      }
    } catch {
      // Overview cards stay hidden; other sections still render.
    } finally {
      setLoadingTracking(false);
    }

    try {
      if (alertHistoryRes && alertHistoryRes.ok) {
        const alertHistoryData = await alertHistoryRes.json();
        if (alertHistoryData.success && Array.isArray(alertHistoryData.data)) {
          setAlertHistory(alertHistoryData.data as ActivityAlertHistoryEntry[]);
        }
      }
    } catch {
      // Activity feed renders without alert rows on failure.
    }

    try {
      if (accuracyRes && accuracyRes.ok) {
        const accuracyData = await accuracyRes.json();
        if (accuracyData.success && accuracyData.data) {
          setAccuracy(accuracyData.data as AccuracySummary);
        }
      }
    } catch {
      // Accuracy section stays hidden on failure.
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

    try {
      if (buyListRes && buyListRes.ok) {
        const buyListData = await buyListRes.json();
        if (buyListData.success && Array.isArray(buyListData.data)) {
          setBuyListItems(buyListData.data as BuyListItemView[]);
        }
      }
    } catch {
      // Buy-list section shows its honest empty state.
    } finally {
      setLoadingBuyList(false);
    }

    try {
      if (protectionRes && protectionRes.ok) {
        const protectionData = await protectionRes.json();
        if (protectionData.success && Array.isArray(protectionData.data)) {
          setProtectionWatches(protectionData.data as ProtectionWatchView[]);
        }
      }
    } catch {
      // Protection section shows its honest empty state.
    } finally {
      setLoadingProtection(false);
    }

    try {
      if (savingsRes && savingsRes.ok) {
        const savingsData = await savingsRes.json();
        if (savingsData.success && savingsData.data) {
          setSavings({
            totalSavedUsd: savingsData.data.totalSavedUsd ?? 0,
            eventCount: savingsData.data.eventCount ?? 0,
            streakWeeks: savingsData.data.streakWeeks ?? 0,
            badge: (savingsData.data.badge ?? 'none') as SaverBadge,
          });
          // Section 13, Chunk F — keep the event list for the
          // savings history card (the endpoint already returns it).
          if (Array.isArray(savingsData.data.events)) {
            setSavingsEvents(savingsData.data.events as SavingsEvent[]);
          }
        }
      }
    } catch {
      // Savings widget stays hidden on failure.
    } finally {
      setLoadingSavings(false);
    }
  }, []);

  // Section 6 handlers: optimistic local update, then the API
  // call. A failed call leaves the optimistic state — the next
  // dashboard load re-reads the truth from the server.
  const handleRemoveBuyListItem = useCallback(async (id: string) => {
    setBuyListItems((items) => items.filter((i) => i.id !== id));
    await fetch(`/api/v1/buy-list/${id}`, { method: 'DELETE' }).catch(() => null);
  }, []);

  const handleBuyListQuantityChange = useCallback(async (id: string, quantity: number) => {
    setBuyListItems((items) =>
      items.map((i) => (i.id === id ? { ...i, quantity } : i))
    );
    await fetch(`/api/v1/buy-list/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity }),
    }).catch(() => null);
  }, []);

  const handleSubmitProtectionClaim = useCallback(async (id: string) => {
    await fetch(`/api/v1/price-protection/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'claim_submitted' }),
    }).catch(() => null);
    setProtectionWatches((watches) =>
      watches.map((w) => (w.id === id ? { ...w, status: 'claim_submitted' } : w))
    );
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
          {/* Section 12, Chunk B — what the sign-in merge carried over
              from this device. Dismissible; shows once per merge. */}
          {mergeNote && (
            <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
              <Heart className="mt-0.5 h-4 w-4 shrink-0 fill-emerald-500 text-emerald-500" />
              <p className="flex-1">
                {mergeNote}{' '}
                <Link href="/dashboard/wishlists" className="font-medium underline">
                  View your wishlist
                </Link>
              </p>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={() => setMergeNote(null)}
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

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
                  Your shopping intelligence dashboard
                </p>
                <Badge className="mt-3 capitalize" variant="secondary">
                  {role} Account
                </Badge>
              </div>
            </div>
          </div>

          {/* Section 12, chunk C — upgrade CTA, honest: payments
              are not live yet (Stripe is in test mode), so this is
              NOT a purchase button. It links to /pricing, which
              states plainly that no paid plan can be bought today
              and no free trial is offered. */}
          <div className="glass-card flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Sparkles className="h-5 w-5 text-blue-600" />
                Premium is coming
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Premium ($9.99/month, planned price) adds unlimited price alerts, AI
                recommendations, review analysis, price prediction and priority support.
                Payments aren&apos;t live yet — no paid plan can be bought today and no free
                trial is offered.
              </p>
            </div>
            <Button asChild className="shrink-0">
              <Link href="/pricing">
                See Premium plans <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>

          {/* Section 13, item 52 — push opt-in on the main
              dashboard. The prompt gates itself on the VAPID check
              and stays honest when push is not configured; a
              dismiss on any page hides it everywhere (shared
              localStorage flag). */}
          <PushOptInPrompt context="home" />

          {/* Activity at a glance — real counts from the user's own data
              (tracking endpoint). Rendered only when the fetch succeeds;
              a failed fetch hides the section instead of showing demo
              numbers. Numbers count up; reduced-motion users see the
              final value immediately. While the counts load, the
              stat-card skeleton (S4#2) holds the space. */}
          {loadingTracking ? (
            <DashboardCardsSkeleton />
          ) : trackingSummary ? (
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
          ) : null}

          {/* Prediction accuracy (S4#8) — from GET
              /api/v1/predictions/accuracy. Until 20 outcomes have
              resolved the component shows "Not enough history yet",
              never a percentage. Hidden entirely when the fetch
              fails. */}
          {accuracy && <AccuracyDashboard summary={accuracy} />}

          {/* Section 13, Chunk F — dashboard depth: watched-price
              summary + per-list glance (from the tracking fetch
              above), alert health + recent activity (tracking +
              alert history + search history, newest first). */}
          <div className="grid gap-6 lg:grid-cols-2">
            <WatchedPriceSummary items={trackingItems} loading={loadingTracking} />
            <ListsAtAGlance items={trackingItems} loading={loadingTracking} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <AlertHealth alerts={trackingAlerts} loading={loadingTracking} />
            <RecentActivityFeed
              items={trackingItems}
              alerts={trackingAlerts}
              alertHistory={alertHistory}
              searchHistory={searchHistory as ActivitySearchEntry[]}
            />
          </div>

          {/* Section 13, Chunk F — first-visit checklist (done-states
              from the tracking fetch) + referral / creator credit. */}
          <div className="grid gap-6 lg:grid-cols-2">
            <GettingStartedChecklist
              hasSavedProduct={trackingItems.length > 0}
              hasAlert={trackingAlerts.length > 0}
            />
            <ReferralCard />
          </div>

          <ActiveDealsSection />

          <div className="grid gap-6 lg:grid-cols-2">
            <UpcomingDealsSection />
            <DropsToWatchSection drops={drops} loading={loadingDrops} />
          </div>

          {/* Landed-cost summary for tracked products (Option 12
              delta) — compact, links out to the full calculator on
              each product page. */}
          <LandedCostWidget />

          {/* Option 16: monthly tech budget vs wishlist total cost.
              Signed-in totals come from the server; guests get a
              device-only budget editor. */}
          <TechBudgetWidget />

          {/* Section 6: buy-list shortlist, price-drop protection
              watches, and the savings ledger. Each section renders
              its honest empty state until the user has real rows. */}
          <div className="grid gap-6 lg:grid-cols-2">
            <BuyListPanel
              items={buyListItems}
              loading={loadingBuyList}
              onRemove={handleRemoveBuyListItem}
              onQuantityChange={handleBuyListQuantityChange}
            />
            <PriceProtectionPanel
              watches={protectionWatches}
              loading={loadingProtection}
              onSubmitClaim={handleSubmitProtectionClaim}
            />
          </div>

          {!loadingSavings && savings && (
            <SavingsWidget
              totalSaved={savings.totalSavedUsd}
              eventCount={savings.eventCount}
              streakWeeks={savings.streakWeeks}
              badge={savings.badge}
            />
          )}

          {/* Section 13, Chunk F — savings ledger detail: which
              purchase saved how much, when (events already returned
              by GET /api/v1/savings). */}
          {!loadingSavings && savings && (
            <SavingsHistory events={savingsEvents} />
          )}

          {/* Section 6, Item 2: autonomous deal hunts — self-fetching
              card, hides itself when the fetch fails. */}
          <AgentHuntsCard />

          {/* Personal shopping digest (Enterprise #13) — saved items,
              alerts, and vector-matched recommendations in one grid.
              Fetches its own data; hides itself on failure. */}
          <DigestGrid />

          {/* Section 13, Chunk F — this week's price-drop digest
              deals (buildPriceDropDigest output), which DigestGrid
              does not show. */}
          <DigestSnapshotCard />

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
                    <div className="mb-2 h-32 overflow-hidden rounded-lg bg-muted">
                      {rec.product.imageUrl ? (
                        <Image src={rec.product.imageUrl} alt={rec.product.name} width={512} height={256} className="h-full w-full object-cover" />
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
                  // Section 13, item 57 — recent searches are links
                  // back to the shareable search URL, not plain text.
                  <Link
                    key={entry.id}
                    href={`/search?q=${encodeURIComponent(entry.query)}`}
                    className="glass-card flex items-center justify-between p-3 transition-shadow hover:shadow-md"
                  >
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
                  </Link>
                ))}
              </div>
            ) : (
              <div className="glass-card">
                <CardContent className="pt-6">
                  <EmptyState
                    icon={Clock}
                    title="No recent searches"
                    description="Your search history will appear here."
                    action={
                      <Button asChild size="sm">
                        <Link href="/search">
                          Search products <ArrowRight className="ml-2 h-4 w-4" />
                        </Link>
                      </Button>
                    }
                  />
                </CardContent>
              </div>
            )}
          </div>

          {/* Section 15, C2 — saved searches (list-only here; the
              save form lives on /search). Re-run links go back to
              /search?<query string>. Guests see nothing: the
              component hides itself when the API 401s. The full
              list with match-notification toggles lives on the
              dedicated page (Section 17, Stage C item 18). */}
          <div className="animate-fade-in motion-reduce:animate-none" style={{ animationDelay: '520ms' }}>
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">Saved searches</h2>
              <Link href="/dashboard/saved-searches" className="text-sm text-blue-600 hover:underline">
                Manage saved searches
              </Link>
            </div>
            <SavedSearches />
          </div>

          {/* Section 15, B12 — past weekly digests archive, newest
              week first, reading GET /api/v1/digests. Honest empty
              state when none were ever generated (including when
              migration 009 is unapplied). */}
          <div className="animate-fade-in motion-reduce:animate-none" style={{ animationDelay: '580ms' }}>
            <DigestArchive />
          </div>
        </div>
      </div>
    </div>
  );
}
