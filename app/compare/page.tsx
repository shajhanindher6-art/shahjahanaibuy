'use client';
import { SiteHeader } from '@/components/layout/site-header';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { SiteFooter } from '@/components/layout/site-footer';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { GitCompare, Search, Trophy, Check, X, Plus, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { PriceAlertDialog } from '@/components/products/price-alert-dialog';
import { CompareMatrixSkeleton } from '@/components/ui/skeleton';
import { ShareButtons } from '@/components/products/share-buttons';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import { fetchTimed } from '@/lib/fetch-timed';
import { computeTrendStats, filterPointsByRange, type TrendPoint } from '@/lib/price-trend';
import { slugify } from '@/lib/brand-category-seo';
import { Price } from '@/components/region/price';
import { useRegion } from '@/components/region/region-provider';
import { tFor } from '@/lib/i18n';
import { DealScoreBadge } from '@/components/products/deal-score-badge';
import { TransparencyBlock } from '@/components/ai/transparency-block';
import { StalePriceBadge } from '@/components/products/stale-price-badge';
import { PriceTrendSparkline } from '@/components/products/price-trend-sparkline';
import { DecisionMatrix } from '@/components/comparison/decision-matrix';
import { SpecMatrix } from '@/components/comparison/spec-matrix';
import { ComparisonSummaryBanner } from '@/components/comparison/comparison-summary-banner';
import {
  CompareValueChecks,
  lowestPrice,
} from '@/components/comparison/compare-value-checks';
import {
  bestDiscount,
  lowestRetailerPrice,
  priceGapLabel,
  priceRangeLabel,
} from '@/lib/compare-pricing';
// Option 16: repairability + regret risk per compared product.
import { RepairabilityMatrix } from '@/components/analytics/RepairabilityMatrix';
import { RegretRiskBadge } from '@/components/analytics/RegretRiskBadge';
import type { RepairabilityData } from '@/services/repairability';
// Option 17: endurance, sustainability & modularity per compared product.
import { EnduranceCard } from '@/components/products/endurance-card';
import { SustainabilityCard } from '@/components/products/sustainability-card';
import { ModularityMatrix } from '@/components/products/modularity-matrix';
import type { HardwareEnduranceData } from '@/services/hardware-endurance';
// Option 18: weight & power per compared product.
import { WeightPowerCard } from '@/components/products/weight-power-card';
import type { PhysicalAttributesData } from '@/services/physical-attributes';
// Option 19: recorded overrides per compared product.
import type { RecordedOverridesData } from '@/services/recorded-overrides';
// Option 20: global readiness per compared product.
import { GlobalReadinessCard } from '@/components/products/global-readiness-card';
import type { GlobalReadinessData } from '@/services/global-readiness';

/**
 * Section 13, Chunk A — 30-day change cell for the comparison
 * matrix. Same /prices data as the sparkline (GET
 * /api/v1/products/[slug]/prices, backed by `price_history`), but a
 * 30-DAY window (filterPointsByRange) instead of the sparkline's
 * last-30-points. Renders "No price history" with fewer than 2
 * recorded points in the window — never a fabricated trend.
 */
function TrendChangeCell({ slug }: { slug: string }) {
  const [change, setChange] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/v1/products/${slug}/prices?limit=60`, {
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error('prices request failed');
        const data = await res.json();
        const history = (data?.data?.history ?? []) as Array<{ price: number; recordedAt: string }>;
        const points: TrendPoint[] = history
          .map((h) => ({ price: Number(h.price), recordedAt: h.recordedAt }))
          .filter((p) => Number.isFinite(p.price) && p.recordedAt);
        const stats = computeTrendStats(filterPointsByRange(points, 30));
        // computeTrendStats returns stats for a single point too
        // (change 0) — but one point measures no change, so fewer
        // than 2 points in the window is "No price history", never
        // a "0.0%" that would read as a flat price.
        if (!cancelled) setChange(stats && stats.pointCount >= 2 ? stats.changePercent : null);
      } catch {
        if (!cancelled) setChange(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (change === undefined) return <span className="text-xs text-muted-foreground">…</span>;
  if (change === null) return <span className="text-sm text-muted-foreground">No price history</span>;
  const fell = change < 0;
  return (
    <span className={cn('text-sm font-medium', fell ? 'text-green-600' : change > 0 ? 'text-red-600' : 'text-muted-foreground')}>
      {change > 0 ? '+' : ''}
      {change.toFixed(1)}% in 30 days
    </span>
  );
}

interface ComparisonRetailer {
  retailerName: string;
  price: number;
  originalPrice: number | null;
  discount: number | null;
  rating: number | null;
  reviewCount: number | null;
  shipping: string | null;
  availability: string;
  seller: string | null;
  warranty: string | null;
  url: string | null;
  /** Section 19, Phase 5 (§12 #50) — merchant reliability for this
      retailer's merchant (null = not enough data to score). */
  reliability?: {
    score: number | null;
    level: string;
    explanation: string;
    notEnoughData: boolean;
  } | null;
}

interface ComparisonProduct {
  productId: string;
  slug: string;
  name: string;
  brand: string | null;
  image: string | null;
  category: string | null;
  retailers: ComparisonRetailer[];
  /** Option 16 repairability (all nulls until migration 019 data exists). */
  repairability?: RepairabilityData | null;
  /** Option 17 hardware endurance (all nulls until migration 020 data exists). */
  endurance?: HardwareEnduranceData | null;
  /** Option 18 physical attributes (all nulls until migration 021 data exists). */
  physical?: PhysicalAttributesData | null;
  /** Option 19 recorded overrides (all nulls until migration 022 data exists). */
  recorded?: RecordedOverridesData | null;
  /** Option 20 global readiness (all nulls until migration 023 data exists). */
  globalReadiness?: GlobalReadinessData | null;
  /**
   * Canonical Deal Score (lib/deal-score.ts), computed server-side
   * in services/ai-comparison.ts from the same price-drop prediction
   * the product page uses. Null when the product has no usable
   * prediction — the table then says "Not enough history", never a
   * synthesized score. Section 16, item 10: when the count is
   * known and below 5, the table says why instead ("4 of 5 points").
   */
  dealScore?: number | null;
  /** Recorded price-history points behind dealScore (Section 16, item 10). */
  dealScoreDataPoints?: number | null;
  /** Recorded `products.data_freshness` (Section 16, item 9). */
  dataFreshness?: string | null;
}

interface Comparison {
  id: string;
  products: ComparisonProduct[];
  aiSummary: string;
  bestChoice: string | null;
  /** Section 19, Phase 5 (§12 #51) — per-requirement suitability
      prose from the comparison API (optional: older cached
      responses may not carry it). */
  suitability?: Array<{
    requirement: string;
    bestProductId: string | null;
    bestProductName: string | null;
    explanation: string;
    dataMissing: string | null;
  }>;
  /** Section 19, Phase 5 (§12 #55) — source label for the verdict. */
  sourceLabel?: string;
}

export default function ComparePage() {
  const router = useRouter();
  const { language } = useRegion();
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ id: string; name: string; slug: string; brand: string | null; image_url: string | null }>>([]);
  const [selectedProducts, setSelectedProducts] = useState<Array<{ id: string; name: string; slug: string }>>([]);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  // Section 14, Chunk 1 — affiliate disclosure flag from the
  // comparison API (true only when a real tag/publisher id is
  // configured server-side). Drives the disclosure note under the
  // merchant links; tag values are never exposed.
  const [affiliateEnabled, setAffiliateEnabled] = useState(false);
  // A failed comparison used to fail silently: comparison stayed null
  // and the page just showed the "Select products" empty state again,
  // as if nothing had been attempted. Surface the failure instead.
  const [compareError, setCompareError] = useState<string | null>(null);

  const searchProducts = useCallback(async (term: string) => {
    if (!term.trim()) return;
    setLoading(true);
    try {
      // P0 fix (2026-11-09 audit): 15s hard timeout — a hanging search
      // used to leave the compare search spinner running forever.
      const res = await fetchTimed(`/api/v1/products?search=${encodeURIComponent(term)}&pageSize=10`, 15000);
      const data = await res.json();
      if (data.success) {
        // Products API returns the list directly in `data` (meta holds
        // pagination). Accept the object shape too, and normalise the
        // image field name, so results can never silently come back empty.
        const list = Array.isArray(data.data) ? data.data : (data.data?.products ?? []);
        setSearchResults(
          list.map((p: Record<string, unknown>) => ({
            id: p.id as string,
            name: p.name as string,
            slug: p.slug as string,
            brand: (p.brand as string | null) ?? null,
            image_url: ((p.image_url ?? p.imageUrl) as string | null) ?? null,
          }))
        );
        setShowSearch(true);
      }
    } catch {
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Section 13: keep ?products= in sync with the selection, so a
  // shared link always re-opens the same comparison. ShareButtons
  // reads window.location.href live, so the shared link was already
  // correct at share time — but a stale ?products= after removing
  // a product still re-opened the removed product on refresh, and
  // a fresh selection never got a deep link at all. router.replace
  // (not push): add/remove must not flood back-button history.
  const syncCompareUrl = useCallback((ids: string[]) => {
    router.replace(ids.length > 0 ? `/compare?products=${ids.join(',')}` : '/compare');
  }, [router]);

  const addProduct = (product: { id: string; name: string; slug: string }) => {
    if (selectedProducts.length >= 5) return;
    if (selectedProducts.find((p) => p.id === product.id)) return;
    const next = [...selectedProducts, product];
    setSelectedProducts(next);
    syncCompareUrl(next.map((p) => p.id));
    setShowSearch(false);
    setSearchTerm('');
    setSearchResults([]);
  };

  const removeProduct = (id: string) => {
    const next = selectedProducts.filter((p) => p.id !== id);
    setSelectedProducts(next);
    syncCompareUrl(next.map((p) => p.id));
    setComparison(null);
    setCompareError(null);
  };

  // Section 11, Chunk C: "save this search" for the compare search
  // box — device-only, reusing the /search page's recent-searches
  // list ('smartbuy-recent-searches', same key, same 8-item cap and
  // case-insensitive dedupe) so a saved term shows up under Recent
  // searches on /search. No background checks, no emails — the saved
  // term is only re-runnable from there. savedCompareTerm holds the
  // last term actually stored, so the button resets itself as soon
  // as the visitor types a different term.
  const [savedCompareTerm, setSavedCompareTerm] = useState('');
  const saveCompareSearch = () => {
    const trimmed = searchTerm.trim();
    if (!trimmed) return;
    try {
      const raw = window.localStorage.getItem('smartbuy-recent-searches');
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(parsed)
        ? parsed.filter((q): q is string => typeof q === 'string')
        : [];
      const next = [
        trimmed,
        ...list.filter((q) => q.toLowerCase() !== trimmed.toLowerCase()),
      ].slice(0, 8);
      window.localStorage.setItem('smartbuy-recent-searches', JSON.stringify(next));
      setSavedCompareTerm(trimmed);
    } catch {
      // Storage unavailable/blocked: report nothing as saved.
    }
  };
  const compareSearchSaved =
    savedCompareTerm !== '' && savedCompareTerm === searchTerm.trim();

  const runComparison = useCallback(
    async (products: Array<{ id: string; name: string; slug: string }>) => {
      if (products.length < 2) return;
      setComparing(true);
      setCompareError(null);
      try {
        // P0 fix (2026-11-09 audit): 30s hard timeout — a hanging
        // comparison used to leave the page on its spinner forever.
        const res = await fetchTimed('/api/v1/comparison', 30000, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productIds: products.map((p) => p.id) }),
        });
        const data = await res.json();
        if (data.success) {
          setComparison(data.data);
          setAffiliateEnabled(data.meta?.affiliateEnabled === true);
        } else {
          setCompareError('Comparison could not be loaded. Please try again.');
        }
      } catch {
        setComparison(null);
        setCompareError('Comparison could not be loaded. Please try again.');
      } finally {
        setComparing(false);
      }
    },
    []
  );

  // S2#8 deep link: /compare?products=<id1>,<id2> (the product page
  // Compare button pushes /compare?products=<id>). Pre-select those
  // products and auto-run the comparison when at least 2 resolve.
  // IDs are resolved through the products list API — the detail
  // endpoint is slug-only, so a UUID cannot be fetched there. An
  // unknown/invalid id is skipped silently (never an error state);
  // a single resolved id is pre-selected and the shopper adds a
  // second product, since a comparison needs at least 2. Read via
  // window.location (not useSearchParams) so the page needs no
  // Suspense boundary (same pattern as /gifts?budget=).
  const deepLinkedRef = useRef(false);
  useEffect(() => {
    if (deepLinkedRef.current) return;
    deepLinkedRef.current = true;
    let ids: string[];
    try {
      const raw = new URLSearchParams(window.location.search).get('products');
      if (!raw) return;
      ids = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 5);
    } catch {
      return;
    }
    if (ids.length === 0) return;
    (async () => {
      try {
        const res = await fetchTimed('/api/v1/products?pageSize=100', 15000);
        const data = await res.json();
        if (!data.success) return;
        const list = Array.isArray(data.data) ? data.data : (data.data?.products ?? []);
        const byId = new Map<string, Record<string, unknown>>(
          (list as Array<Record<string, unknown>>).map((p) => [p.id as string, p])
        );
        const matched = ids.flatMap((id) => {
          const p = byId.get(id);
          return p
            ? [{ id: p.id as string, name: p.name as string, slug: p.slug as string }]
            : [];
        });
        if (matched.length === 0) return;
        setSelectedProducts(matched);
        if (matched.length >= 2) void runComparison(matched);
      } catch {
        // Unresolvable deep link: leave the normal empty state.
      }
    })();
    // Runs once on mount: runComparison is a stable useCallback
    // (argument + setters only, [] deps), so listing it keeps this
    // a one-shot pre-select instead of re-running on every render.
  }, [runComparison]);

  // Section 13: empty-state suggestions when exactly one product is
  // selected — same-category products from the existing
  // /api/v1/products/[slug]/similar endpoint, plus a "Compare all
  // <category>" link. Nothing is shown when the endpoint returns
  // nothing: no invented suggestions.
  interface SimilarSuggestion {
    id: string;
    name: string;
    slug: string;
    brand: string | null;
    category: string | null;
  }
  const [similarSuggestions, setSimilarSuggestions] = useState<SimilarSuggestion[]>([]);
  useEffect(() => {
    if (selectedProducts.length !== 1) {
      setSimilarSuggestions([]);
      return;
    }
    const slug = selectedProducts[0].slug;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchTimed(`/api/v1/products/${slug}/similar?limit=4`, 15000);
        const data = await res.json();
        if (!cancelled && data.success && Array.isArray(data.data)) {
          setSimilarSuggestions(
            (data.data as Array<Record<string, unknown>>)
              .filter((p) => typeof p.slug === 'string' && p.slug !== slug)
              .slice(0, 3)
              .map((p) => ({
                id: p.id as string,
                name: p.name as string,
                slug: p.slug as string,
                brand: (p.brand as string | null) ?? null,
                category: (p.category as string | null) ?? null,
              }))
          );
        }
      } catch {
        if (!cancelled) setSimilarSuggestions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedProducts]);

  // Section 13: distinct retailer names across the compared
  // products, for the merchant × product price grid below.
  const retailerNames = useMemo(
    () => [
      ...new Set(
        (comparison?.products ?? []).flatMap((p) => p.retailers.map((r) => r.retailerName))
      ),
    ],
    [comparison]
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <SiteHeader />
      {/* Section 16, item 14: page-level JSON-LD (WebPage + BreadcrumbList). */}
      <PageJsonLd
        name="Product Comparison"
        description="Compare products across retailers with deterministic, rule-based insights — real recorded prices and price history only."
        path="/compare"
        crumbs={[ { name: "Home", path: "/" }, { name: "Product Comparison" } ]}
      />
      <div className="container mx-auto max-w-6xl px-4 py-8">
        <div className="mb-8 text-center">
          <h1 className="flex items-center justify-center gap-2 text-3xl font-bold sm:text-4xl">
            <GitCompare className="h-8 w-8 text-blue-600" aria-hidden="true" />
            {tFor(language, 'pageHeadingCompare')}
          </h1>
          <p className="mt-2 text-muted-foreground">
            Compare products across retailers with deterministic, rule-based insights
          </p>
        </div>

        <Card className="mb-6">
          <CardHeader>
            {/* h2, not CardTitle: CardTitle renders an h3, and this
                page's hierarchy is h1 → h2 (no h2 existed before). */}
            <h2 className="text-2xl font-semibold leading-none tracking-tight text-base">Select Products to Compare ({selectedProducts.length}/5)</h2>
            <CardDescription>Choose 2-5 products for a detailed comparison</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), searchProducts(searchTerm))}
                  placeholder="Search for products to compare..."
                  aria-label="Search for products to compare"
                  className="pl-10"
                />
              </div>
              <Button onClick={() => searchProducts(searchTerm)} disabled={loading || !searchTerm.trim()} className="min-h-[44px]">
                {loading ? <LoadingSpinner size="sm" /> : 'Find'}
              </Button>
            </div>

            {showSearch && !loading && searchResults.length === 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-sm text-muted-foreground">
                  No products found for that search. Try a different term.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={saveCompareSearch}
                    disabled={compareSearchSaved}
                  >
                    <Bell className="mr-2 h-4 w-4" />
                    {compareSearchSaved ? 'Search saved' : 'Save this search'}
                  </Button>
                  {compareSearchSaved && (
                    <p className="text-xs text-muted-foreground">
                      Saved on this device — find it under Recent searches on the Search page.
                      Nothing checks for new matches in the background; re-run it there to see
                      if anything new appeared.
                    </p>
                  )}
                </div>
              </div>
            )}

            {showSearch && searchResults.length > 0 && (
              <div className="mt-4 space-y-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                {searchResults.map((product) => (
                  <Button
                    key={product.id}
                    type="button"
                    variant="ghost"
                    onClick={() => addProduct({ id: product.id, name: product.name, slug: product.slug })}
                    aria-label={`Add ${product.name} to comparison`}
                    className="h-auto min-h-[44px] w-full justify-between whitespace-normal rounded-md p-2 text-left font-normal"
                  >
                    <div>
                      <span className="font-medium">{product.name}</span>
                      {product.brand && <span className="ml-2 text-sm text-muted-foreground">{product.brand}</span>}
                    </div>
                    <Plus className="h-4 w-4 text-blue-600" />
                  </Button>
                ))}
              </div>
            )}

            {selectedProducts.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {selectedProducts.map((product) => (
                  <Badge key={product.id} variant="secondary" className="flex items-center gap-1 py-1.5">
                    {product.name}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeProduct(product.id)}
                      aria-label={`Remove ${product.name} from comparison`}
                      className="ml-1 rounded-full"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </Badge>
                ))}
              </div>
            )}

            {selectedProducts.length >= 2 && (
              <Button onClick={() => runComparison(selectedProducts)} disabled={comparing} className="mt-4 min-h-[44px] w-full">
                {comparing ? <LoadingSpinner size="sm" /> : <GitCompare className="mr-2 h-4 w-4" />}
                Compare {selectedProducts.length} Products
              </Button>
            )}
          </CardContent>
        </Card>

        {comparing && (
          <CompareMatrixSkeleton className="py-4" />
        )}

        {!comparing && compareError && !comparison && (
          <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {compareError}
          </p>
        )}

        {!comparing && !comparison && selectedProducts.length === 1 && similarSuggestions.length > 0 && (
          <Card className="mb-6">
            <CardHeader>
              <h2 className="text-base font-semibold leading-none tracking-tight">Compare with similar products</h2>
              <CardDescription>
                Same-category products from the catalog — add one to compare it against {selectedProducts[0].name}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {similarSuggestions[0].category && (
                <Button asChild variant="outline" className="mb-3 min-h-[44px]">
                  <Link href={`/categories/${slugify(similarSuggestions[0].category)}`}>
                    Compare all {similarSuggestions[0].category}
                  </Link>
                </Button>
              )}
              <div className="flex flex-wrap gap-2">
                {similarSuggestions.map((s) => (
                  <Button
                    key={s.id}
                    type="button"
                    variant="outline"
                    onClick={() => addProduct({ id: s.id, name: s.name, slug: s.slug })}
                    aria-label={`Add ${s.name} to comparison`}
                    className="h-auto min-h-[44px] whitespace-normal"
                  >
                    <Plus className="mr-1 h-4 w-4 shrink-0" /> {s.name}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {!comparing && !comparison && selectedProducts.length < 2 && (
          <EmptyState
            title="Select products to compare"
            description="Search and add at least 2 products to see a detailed comparison"
            icon={GitCompare}
            action={
              selectedProducts.length === 1 ? (
                <div className="flex flex-col items-center gap-2">
                  <PriceAlertDialog
                    productId={selectedProducts[0].id}
                    productName={selectedProducts[0].name}
                  />
                  <p className="max-w-sm text-xs text-muted-foreground">
                    Only one product so far — set a price alert on it while you look for a
                    second. Guest alerts are saved on this device only.
                  </p>
                </div>
              ) : (
                <Button onClick={() => router.push('/search')}>Browse products</Button>
              )
            }
          />
        )}

        {comparison && !comparing && (
          <div className="space-y-6">
            <Card className="border-blue-200 bg-gradient-to-r from-blue-50 to-cyan-50 dark:border-blue-800 dark:from-blue-950 dark:to-cyan-950">
              <CardHeader>
                {/* h2, not CardTitle (renders h3): this page's
                    hierarchy is h1 → h2. */}
                <h2 className="flex items-center gap-2 text-2xl font-semibold leading-none tracking-tight">
                  <Trophy className="h-5 w-5 text-yellow-500" aria-hidden="true" />
                  AI Comparison Summary
                </h2>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed">{comparison.aiSummary}</p>
              </CardContent>
            </Card>

            {/* Section 19, fix-up (§12 #70): shared transparency
                block for the comparison verdict — the Best Choice
                formula (services/ai-comparison.ts
                determineBestChoice), what was compared, and what the
                verdict never uses. Fed only from the comparison
                response already on this page; the API returns no
                generation timestamp, so the block says so instead of
                inventing one. */}
            <TransparencyBlock
              title="How this comparison was calculated"
              dataUsed={[
                `${comparison.products.length} products across ${retailerNames.length} retailer${retailerNames.length !== 1 ? 's' : ''} — recorded merchant prices, discounts, ratings, availability and Deal Scores from the comparison response.`,
                'Best Choice score: (100 ÷ lowest recorded price) × 30 + average rating × 10 + in-stock retailer count × 5 — the lowest price weighs most.',
                'Each product carries its recorded price date (shown next to its best price as a stale-price badge); no live retailer price is checked.',
                ...(comparison.sourceLabel ? [comparison.sourceLabel] : []),
              ]}
              dataTimestamp={null}
              dataTimestampLabel="Comparison generated at"
              confidence={
                comparison.bestChoice
                  ? `Best Choice (${comparison.products.find((p) => p.productId === comparison.bestChoice)?.name ?? 'the picked product'}) is the highest weighted score from the formula above — a ranking, not a measured quality rating and not a guarantee of value.`
                  : 'No Best Choice was picked — fewer than 2 products, or no product could be scored.'
              }
              assumptions={[
                'The lowest recorded price per product is treated as its comparable price.',
                'A product with no retailer listings cannot be Best Choice — its price counts as infinitely high in the formula.',
              ]}
              missingInfo={[
                'Warranty, shipping and seller information are shown as recorded (or as "not recorded") and never affect Best Choice.',
                'Merchant reliability is shown separately and does not affect Best Choice.',
                'No review text and no specification data beyond the recorded attributes are used for the verdict.',
              ]}
            />

            {/* Share this comparison (S3#10): the comparison URL is a
                deep link (/compare?products=…), so the shared link
                re-opens the same comparison. Referral opt-in on. */}
            <div aria-label="Share this comparison">
              <ShareButtons
                title={`Product comparison: ${comparison.products.map((p) => p.name).join(' vs ')}`}
                text={`Compare ${comparison.products.map((p) => p.name).join(', ')} on SmartBuy AI`}
                enableReferral
              />
            </div>

            {/* Mobile cards: the matrix below is a wide table — on
                phones it becomes one card per product instead of a
                sideways-scrolling table. Desktop keeps the table. */}
            <div className="grid gap-4 md:hidden">
              {comparison.products.map((p) => {
                const prices = p.retailers.map((r) => r.price);
                const minPrice = prices.length > 0 ? Math.min(...prices) : null;
                const allPrices = comparison.products.flatMap((p2) => p2.retailers.map((r) => r.price));
                const overallMin = allPrices.length > 0 ? Math.min(...allPrices) : null;
                const rating = p.retailers.find((r) => r.rating !== null && r.rating !== undefined)?.rating;
                // B10/B11/B15: discount, gap and range for this
                // product, from the retailer rows already in the
                // response (see lib/compare-pricing).
                const discount = bestDiscount(p.retailers);
                const gap = priceGapLabel(minPrice, overallMin);
                const range = priceRangeLabel(prices);
                return (
                  <Card key={p.productId}>
                    <CardContent className="space-y-2 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold">{p.name}</p>
                          {p.brand && <p className="text-xs text-muted-foreground">{p.brand}</p>}
                        </div>
                        {comparison.bestChoice === p.productId && (
                          <Badge className="bg-yellow-500 text-xs">Best Choice</Badge>
                        )}
                      </div>
                      <p className="text-sm">
                        <span className="font-medium">Best price: </span>
                        {minPrice !== null ? (
                          <span className={cn('font-bold', minPrice === overallMin ? 'text-green-600' : '')}>
                            <Price usd={minPrice} showFxNote />
                          </span>
                        ) : (
                          <span className="text-muted-foreground">No listings</span>
                        )}
                      </p>
                      {/* Section 16, item 9: stale-price badge +
                          age-in-days next to the best price. */}
                      {minPrice !== null && (
                        <p className="text-sm">
                          <StalePriceBadge dataFreshness={p.dataFreshness} />
                        </p>
                      )}
                      <p className="text-sm">
                        <span className="font-medium">Best discount: </span>
                        {discount !== null ? (
                          <span className="font-semibold text-green-600">−{discount}%</span>
                        ) : (
                          <span className="text-muted-foreground">No discount listed</span>
                        )}
                      </p>
                      <p className="text-sm">
                        <span className="font-medium">Price gap: </span>
                        {gap !== null ? (
                          <span className={cn(gap === 'Cheapest' ? 'font-semibold text-green-600' : '')}>{gap}</span>
                        ) : (
                          <span className="text-muted-foreground">No listings</span>
                        )}
                      </p>
                      <p className="text-sm">
                        <span className="font-medium">Price range: </span>
                        {range !== null ? (
                          <span>{range}</span>
                        ) : (
                          <span className="text-muted-foreground">No listings</span>
                        )}
                      </p>
                      <p className="flex items-center gap-2 text-sm">
                        <span className="font-medium">Deal Score: </span>
                        {p.dealScore != null ||
                        (p.dealScoreDataPoints != null && p.dealScoreDataPoints < 5) ? (
                          <DealScoreBadge
                            score={p.dealScore ?? null}
                            dataPoints={p.dealScoreDataPoints}
                            size="sm"
                            showLabel
                          />
                        ) : (
                          <span className="text-muted-foreground">Not enough history</span>
                        )}
                      </p>
                      <p className="text-sm">
                        <span className="font-medium">Rating: </span>
                        {rating !== null && rating !== undefined ? (
                          <span className="font-semibold">{rating.toFixed(1)} ★</span>
                        ) : (
                          <span className="text-muted-foreground">Not rated</span>
                        )}
                      </p>
                      <p className="text-sm">
                        <span className="font-medium">Availability: </span>
                        {p.retailers.length === 0 ? (
                          <Badge variant="secondary">No listings</Badge>
                        ) : (
                          <Badge variant={p.retailers.some((r) => r.availability === 'in_stock') ? 'default' : 'destructive'}>
                            {p.retailers.some((r) => r.availability === 'in_stock') ? 'In Stock' : 'Out of Stock'}
                          </Badge>
                        )}
                      </p>
                      {/* Section 19, Phase 5 (§12 #49/#57): warranty,
                          shipping and seller from the retailer rows
                          the API already returns — real recorded data
                          when it exists, an honest empty state when
                          it doesn't (0 warranty rows live; shipping
                          only when a listing records it). */}
                      <p className="text-sm">
                        <span className="font-medium">Warranty: </span>
                        {p.retailers.find((r) => r.warranty)?.warranty ?? (
                          <span className="text-muted-foreground">No warranty information recorded</span>
                        )}
                      </p>
                      <p className="text-sm">
                        <span className="font-medium">Shipping: </span>
                        {p.retailers.find((r) => r.shipping)?.shipping ?? (
                          <span className="text-muted-foreground">No shipping information recorded</span>
                        )}
                      </p>
                      <p className="text-sm">
                        <span className="font-medium">Seller: </span>
                        {(() => {
                          const sellers = [...new Set(p.retailers.map((r) => r.seller).filter((s): s is string => s !== null && s !== ''))];
                          return sellers.length > 0 ? (
                            sellers.join(', ')
                          ) : (
                            <span className="text-muted-foreground">No seller information recorded</span>
                          );
                        })()}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {p.retailers.length} retailer{p.retailers.length !== 1 ? 's' : ''}
                      </p>
                      {/* Section 13: merchant × product prices + the
                          30-day change on mobile cards too — the
                          matrix below is desktop-only. */}
                      {p.retailers.length > 0 && (
                        <div className="space-y-0.5 text-sm">
                          {p.retailers.map((r) => (
                            <p key={r.retailerName}>
                              {/* Section 14, Chunk 1 — merchant
                                  outbound link. The URL comes from
                                  the comparison API, already passed
                                  through the env-gated affiliate
                                  transform server-side (no tag when
                                  nothing is configured); a retailer
                                  with no URL stays plain text. */}
                              {r.url ? (
                                <a
                                  href={r.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-medium underline underline-offset-2"
                                >
                                  {r.retailerName}
                                </a>
                              ) : (
                                <span className="font-medium">{r.retailerName}</span>
                              )}
                              <span>: </span>
                              <Price usd={r.price} showFxNote />
                              {/* B10: compare-at price + discount for
                                  this listing, from the retailer row
                                  the API already returns. */}
                              {r.originalPrice !== null && r.originalPrice !== undefined && r.originalPrice > r.price && (
                                <span className="ml-1 text-xs text-muted-foreground line-through">
                                  <Price usd={r.originalPrice} />
                                </span>
                              )}
                              {r.discount !== null && r.discount !== undefined && r.discount > 0 && (
                                <span className="ml-1 text-xs font-semibold text-green-600">
                                  −{r.discount}%
                                </span>
                              )}
                            </p>
                          ))}
                        </div>
                      )}
                      <p className="flex items-center gap-2 text-sm">
                        <span className="font-medium">30-day change: </span>
                        <TrendChangeCell slug={p.slug} />
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="min-h-[44px]"
                          onClick={() => router.push(`/products/${p.slug || p.productId}`)}
                        >
                          View Details
                        </Button>
                        {/* B12: price alert from the mobile card —
                            same dialog as the product page; guests get
                            its sign-in prompt, not a dead end. */}
                        <PriceAlertDialog
                          productId={p.productId}
                          productName={p.name}
                          currentPrice={minPrice}
                        />
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b-2 border-slate-200 dark:border-slate-700">
                    <th scope="col" className="p-3 text-left text-sm font-medium text-muted-foreground">Feature</th>
                    {comparison.products.map((p) => (
                      <th scope="col" key={p.productId} className="p-3 text-left">
                        <div className="space-y-1">
                          <span className="block font-semibold">{p.name}</span>
                          {p.brand && <span className="block text-xs text-muted-foreground">{p.brand}</span>}
                          {comparison.bestChoice === p.productId && (
                            <Badge className="bg-yellow-500 text-xs">Best Choice</Badge>
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <td scope="row" className="p-3 text-sm font-medium">Best Price</td>
                    {comparison.products.map((p) => {
                      const prices = p.retailers.map((r) => r.price);
                      const minPrice = prices.length > 0 ? Math.min(...prices) : null;
                      const allPrices = comparison.products.flatMap((p2) => p2.retailers.map((r) => r.price));
                      const overallMin = allPrices.length > 0 ? Math.min(...allPrices) : null;
                      return (
                        <td key={p.productId} className="p-3">
                          {minPrice !== null ? (
                            <span className={cn('font-bold', minPrice === overallMin ? 'text-green-600' : '')}>
                              <Price usd={minPrice} showFxNote />
                            </span>
                          ) : (
                            <span className="text-sm text-muted-foreground">No listings</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  {/* B10: best discount — the API already computes
                      each retailer's discount from its compare-at
                      price (services/ai-comparison.ts); this row
                      only shows the largest one per product. */}
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <td scope="row" className="p-3 text-sm font-medium">Best discount</td>
                    {comparison.products.map((p) => {
                      const discount = bestDiscount(p.retailers);
                      return (
                        <td key={p.productId} className="p-3">
                          {discount !== null ? (
                            <span className="font-semibold text-green-600">−{discount}%</span>
                          ) : (
                            <span className="text-sm text-muted-foreground">No discount listed</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  {/* B11: price gap vs the cheapest product in this
                      comparison — "$0" would read as free, so the
                      cheapest product says "Cheapest". */}
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <td scope="row" className="p-3 text-sm font-medium">Price gap vs cheapest</td>
                    {comparison.products.map((p) => {
                      const prices = p.retailers.map((r) => r.price);
                      const minPrice = lowestRetailerPrice(prices);
                      const allPrices = comparison.products.flatMap((p2) => p2.retailers.map((r) => r.price));
                      const overallMin = lowestRetailerPrice(allPrices);
                      const gap = priceGapLabel(minPrice, overallMin);
                      return (
                        <td key={p.productId} className="p-3 text-sm">
                          {gap !== null ? (
                            <span className={cn(gap === 'Cheapest' ? 'font-semibold text-green-600' : '')}>{gap}</span>
                          ) : (
                            <span className="text-muted-foreground">No listings</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  {/* B15: price range across the product's own
                      retailers — one price when every listing
                      agrees, a range when they differ. */}
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <td scope="row" className="p-3 text-sm font-medium">Price range</td>
                    {comparison.products.map((p) => {
                      const range = priceRangeLabel(p.retailers.map((r) => r.price));
                      return (
                        <td key={p.productId} className="p-3 text-sm">
                          {range !== null ? (
                            range
                          ) : (
                            <span className="text-muted-foreground">No listings</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  {/* Section 13: merchant × product price grid — one
                      row per retailer across all compared products,
                      from the retailers[] already in the response.
                      A product with no listing at that retailer
                      says "Not listed", never a guessed price. */}
                  {retailerNames.map((name) => (
                    <tr key={name} className="border-b border-slate-100 dark:border-slate-800">
                      <td scope="row" className="p-3 text-sm font-medium">
                        {name}
                        {/* Section 19, Phase 5 (§12 #50): merchant
                            reliability for this retailer, scored only
                            from recorded signals — a score when enough
                            signals exist, an honest "not enough data"
                            note when they don't. Reliability is per
                            merchant, so the first listing carrying it
                            speaks for the row. */}
                        <span className="block text-xs font-normal text-muted-foreground">
                          {(() => {
                            const reliability = comparison.products
                              .flatMap((p) => p.retailers)
                              .find((r) => r.retailerName === name)?.reliability;
                            if (!reliability) return 'Reliability: not enough data to score this merchant';
                            if (reliability.notEnoughData || reliability.score === null) {
                              return 'Reliability: not enough data to score this merchant';
                            }
                            return `Reliability: ${reliability.level} (${reliability.score}/100)`;
                          })()}
                        </span>
                      </td>
                      {comparison.products.map((p) => {
                        const row = p.retailers.find((r) => r.retailerName === name);
                        return (
                          <td key={p.productId} className="p-3">
                            {row ? (
                              <span className="flex flex-col gap-1">
                                {/* B10: compare-at price (struck
                                    through) + discount for this
                                    listing, from the retailer row the
                                    API already returns. */}
                                <span className="flex flex-wrap items-baseline gap-1">
                                  <Price usd={row.price} showFxNote />
                                  {row.originalPrice !== null && row.originalPrice !== undefined && row.originalPrice > row.price && (
                                    <span className="text-xs text-muted-foreground line-through">
                                      <Price usd={row.originalPrice} />
                                    </span>
                                  )}
                                  {row.discount !== null && row.discount !== undefined && row.discount > 0 && (
                                    <Badge variant="secondary" className="bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300">
                                      −{row.discount}%
                                    </Badge>
                                  )}
                                </span>
                                {/* Section 14, Chunk 1 — merchant
                                    outbound link (see the mobile card
                                    above for the transform note). No
                                    URL, no link — never a guessed
                                    retailer address. */}
                                {row.url && (
                                  <a
                                    href={row.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs font-medium text-primary underline underline-offset-2"
                                  >
                                    Visit {name}
                                  </a>
                                )}
                              </span>
                            ) : (
                              <span className="text-sm text-muted-foreground">Not listed</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <td scope="row" className="p-3 text-sm font-medium">Deal Score</td>
                    {comparison.products.map((p) => (
                      <td key={p.productId} className="p-3">
                        {p.dealScore != null ||
                        (p.dealScoreDataPoints != null && p.dealScoreDataPoints < 5) ? (
                          <DealScoreBadge
                            score={p.dealScore ?? null}
                            dataPoints={p.dealScoreDataPoints}
                            size="sm"
                            showLabel
                          />
                        ) : (
                          <span className="text-sm text-muted-foreground">Not enough history</span>
                        )}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <td scope="row" className="p-3 text-sm font-medium">Price trend</td>
                    {comparison.products.map((p) => (
                      <td key={p.productId} className="p-3">
                        {/* Self-fetching sparkline from real price
                            history; renders nothing when a product has
                            fewer than 2 recorded points, so the cell
                            stays empty rather than showing a fake
                            trend. */}
                        <PriceTrendSparkline slug={p.slug} showChange />
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <td scope="row" className="p-3 text-sm font-medium">30-day change</td>
                    {comparison.products.map((p) => (
                      <td key={p.productId} className="p-3">
                        {/* Section 13: "−X% in 30 days" from the same
                            /prices data as the sparkline above, over
                            a 30-day window (see TrendChangeCell). */}
                        <TrendChangeCell slug={p.slug} />
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <td scope="row" className="p-3 text-sm font-medium">Rating</td>
                    {comparison.products.map((p) => {
                      // Ratings are shared across a product's retailer
                      // rows (one average from the reviews table); take
                      // the first non-null one so a first row without a
                      // rating cannot hide a rating carried by another.
                      // Missing data is words, never a dash: a dash in
                      // a specs-style table reads as a broken field.
                      const rating = p.retailers.find((r) => r.rating !== null && r.rating !== undefined)?.rating;
                      return (
                        <td key={p.productId} className="p-3">
                          {rating !== null && rating !== undefined ? (
                            <span className="flex items-center gap-1">
                              <span className="font-semibold">{rating.toFixed(1)}</span>
                              <span className="text-xs text-muted-foreground">★</span>
                            </span>
                          ) : (
                            <span className="text-sm text-muted-foreground">Not rated</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <td scope="row" className="p-3 text-sm font-medium">Reviews</td>
                    {comparison.products.map((p) => {
                      // Never invent "0": with no retailer rows (or no
                      // count on any row) the honest cell is "No review
                      // data", not a zero that would read as "this
                      // product has no reviews". A real 0 from the
                      // reviews table still renders as 0.
                      const reviewCount = p.retailers.find(
                        (r) => r.reviewCount !== null && r.reviewCount !== undefined
                      )?.reviewCount;
                      return (
                        <td key={p.productId} className="p-3 text-sm">
                          {reviewCount !== null && reviewCount !== undefined ? (
                            reviewCount
                          ) : (
                            <span className="text-muted-foreground">No review data</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <td scope="row" className="p-3 text-sm font-medium">Availability</td>
                    {comparison.products.map((p) => (
                      <td key={p.productId} className="p-3">
                        {/* S2#15: zero retailer rows is "No listings",
                            never "Out of Stock" — no listing exists to
                            be out of stock, and the old fallback
                            badge claimed otherwise. */}
                        {p.retailers.length === 0 ? (
                          <Badge variant="secondary">No listings</Badge>
                        ) : (
                          <Badge variant={p.retailers.some((r) => r.availability === 'in_stock') ? 'default' : 'destructive'}>
                            {p.retailers.some((r) => r.availability === 'in_stock') ? 'In Stock' : 'Out of Stock'}
                          </Badge>
                        )}
                      </td>
                    ))}
                  </tr>
                  {/* Section 19, Phase 5 (§12 #49/#57): warranty,
                      shipping and seller rows — real recorded data
                      when a listing carries it, an honest empty
                      state when it doesn't. Warranty comes from the
                      merchant's recorded policy (0 rows live);
                      shipping from the listing's recorded cost/days;
                      the seller is the merchant of record. */}
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <td scope="row" className="p-3 text-sm font-medium">Warranty</td>
                    {comparison.products.map((p) => {
                      const warranty = p.retailers.find((r) => r.warranty)?.warranty;
                      return (
                        <td key={p.productId} className="p-3 text-sm">
                          {warranty ?? (
                            <span className="text-muted-foreground">No warranty information recorded</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <td scope="row" className="p-3 text-sm font-medium">Shipping</td>
                    {comparison.products.map((p) => {
                      const shipping = p.retailers.find((r) => r.shipping)?.shipping;
                      return (
                        <td key={p.productId} className="p-3 text-sm">
                          {shipping ?? (
                            <span className="text-muted-foreground">No shipping information recorded</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <td scope="row" className="p-3 text-sm font-medium">Seller</td>
                    {comparison.products.map((p) => {
                      const sellers = [
                        ...new Set(
                          p.retailers
                            .map((r) => r.seller)
                            .filter((s): s is string => s !== null && s !== '')
                        ),
                      ];
                      return (
                        <td key={p.productId} className="p-3 text-sm">
                          {sellers.length > 0 ? (
                            sellers.join(', ')
                          ) : (
                            <span className="text-muted-foreground">No seller information recorded</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <td scope="row" className="p-3 text-sm font-medium">Retailers</td>
                    {comparison.products.map((p) => (
                      <td key={p.productId} className="p-3 text-sm">
                        {p.retailers.length} retailer{p.retailers.length !== 1 ? 's' : ''}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td scope="row" className="p-3 text-sm font-medium">Actions</td>
                    {comparison.products.map((p) => (
                      <td key={p.productId} className="p-3">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="min-h-[44px]"
                            onClick={() => router.push(`/products/${p.slug || p.productId}`)}
                          >
                            View Details
                          </Button>
                          {/* B12: price alert from the matrix — the
                              same dialog the product page uses;
                              guests get its sign-in prompt. */}
                          <PriceAlertDialog
                            productId={p.productId}
                            productName={p.name}
                            currentPrice={lowestRetailerPrice(p.retailers.map((r) => r.price))}
                          />
                        </div>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Section 14, Chunk 1 — affiliate disclosure, rendered
                ONLY when the server reports a real tag/publisher id
                configured. With nothing configured there is no note,
                because there is nothing to disclose. */}
            {affiliateEnabled && (
              <p className="text-xs text-muted-foreground">
                Affiliate disclosure: SmartBuy may earn a commission from qualifying purchases
                made through these retailer links, at no extra cost to you.
              </p>
            )}

            {/* Summary banner (Option 14-B): deterministic badges
                earned from real specs/prices only — renders nothing
                when no badge is earned. */}
            <ComparisonSummaryBanner products={comparison.products} />

            {/* Section 19, Phase 5 (§12 #51): per-requirement
                suitability prose — which product suits each
                requirement better and WHY, grounded in the real
                rows. Renders nothing when the API carries no
                suitability (older cached responses). */}
            {comparison.suitability && comparison.suitability.length > 0 && (
              <div>
                <h2 className="mb-3 text-lg font-semibold">Which suits what</h2>
                <ul className="space-y-2">
                  {comparison.suitability.map((s) => (
                    <li key={s.requirement} className="text-sm leading-relaxed">
                      <span className="font-medium">{s.requirement}: </span>
                      {s.explanation}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Decision Matrix (Enterprise #7): the same products in a
                metric-first table built from recorded data only. */}
            <DecisionMatrix products={comparison.products} />

            {/* Spec Matrix (Option 14-B): the same products side by
                side on their seeded specifications (RAM, Storage,
                Battery, …). */}
            <SpecMatrix products={comparison.products} />

            {/* Value checks (batch 2): estimated total ownership cost,
                fake-sale verdict, and simulated 24-month resale — all
                from each product's recorded prices. */}
            <CompareValueChecks
              products={comparison.products.map((p) => ({
                slug: p.slug,
                name: p.name,
                lowestPriceUsd: lowestPrice(p.retailers.map((r) => r.price)),
                recordedAnnualRate: p.recorded?.annualDepreciationRate ?? null,
                mandatoryAccessoriesCost: p.recorded?.mandatoryAccessoriesCost ?? null,
              }))}
            />

            {/* Option 16: repairability + regret risk per product.
                SpecTradeoffTable stays on the product page — the
                comparison API carries no spec rows (SpecMatrix above
                already covers specs here). */}
            <div>
              <h2 className="mb-3 text-lg font-semibold">Repairability &amp; Regret Risk</h2>
              <div className="grid gap-6 lg:grid-cols-2">
                {comparison.products.map((p) => (
                  <div key={p.productId} className="space-y-6">
                    <RepairabilityMatrix
                      repairability={p.repairability ?? null}
                      title={p.name}
                    />
                    <RegretRiskBadge
                      priceUsd={lowestPrice(p.retailers.map((r) => r.price))}
                      specTier={null}
                      specsRecorded={false}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Option 17: endurance, sustainability & modularity per
                product — all honest empty states until migration 020
                data exists. */}
            <div>
              <h2 className="mb-3 text-lg font-semibold">
                Hardware Endurance &amp; Sustainability
              </h2>
              <div className="grid gap-6 lg:grid-cols-2">
                {comparison.products.map((p) => (
                  <div key={p.productId} className="space-y-6">
                    <EnduranceCard endurance={p.endurance ?? null} title={p.name} />
                    <SustainabilityCard
                      carbonFootprintKg={p.endurance?.carbonFootprintKg ?? null}
                      category={p.category ?? null}
                      title={p.name}
                    />
                    <ModularityMatrix endurance={p.endurance ?? null} title={p.name} />
                  </div>
                ))}
              </div>
            </div>

            {/* Option 18: weight & power per product — all honest empty
                states until migration 021 data exists. */}
            <div>
              <h2 className="mb-3 text-lg font-semibold">Weight &amp; Power</h2>
              <div className="grid gap-6 lg:grid-cols-2">
                {comparison.products.map((p) => (
                  <div key={p.productId} className="space-y-6">
                    <WeightPowerCard physical={p.physical ?? null} title={p.name} />
                  </div>
                ))}
              </div>
            </div>

            {/* Option 20: global readiness per product — all honest empty
                states until migration 023 data exists. */}
            <div>
              <h2 className="mb-3 text-lg font-semibold">Global Readiness</h2>
              <div className="grid gap-6 lg:grid-cols-2">
                {comparison.products.map((p) => (
                  <div key={p.productId} className="space-y-6">
                    <GlobalReadinessCard
                      globalReadiness={p.globalReadiness ?? null}
                      title={p.name}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      <SiteFooter />
    </div>
  );
}
