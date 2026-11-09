'use client';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { GitCompare, Search, Trophy, Check, X, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import { Price } from '@/components/region/price';
import { DecisionMatrix } from '@/components/comparison/decision-matrix';
import { SpecMatrix } from '@/components/comparison/spec-matrix';
import { ComparisonSummaryBanner } from '@/components/comparison/comparison-summary-banner';
import {
  CompareValueChecks,
  lowestPrice,
} from '@/components/comparison/compare-value-checks';
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
}

interface Comparison {
  id: string;
  products: ComparisonProduct[];
  aiSummary: string;
  bestChoice: string | null;
}

export default function ComparePage() {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ id: string; name: string; slug: string; brand: string | null; image_url: string | null }>>([]);
  const [selectedProducts, setSelectedProducts] = useState<Array<{ id: string; name: string; slug: string }>>([]);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  // A failed comparison used to fail silently: comparison stayed null
  // and the page just showed the "Select products" empty state again,
  // as if nothing had been attempted. Surface the failure instead.
  const [compareError, setCompareError] = useState<string | null>(null);

  const searchProducts = useCallback(async (term: string) => {
    if (!term.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/products?search=${encodeURIComponent(term)}&pageSize=10`);
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

  const addProduct = (product: { id: string; name: string; slug: string }) => {
    if (selectedProducts.length >= 5) return;
    if (selectedProducts.find((p) => p.id === product.id)) return;
    setSelectedProducts([...selectedProducts, product]);
    setShowSearch(false);
    setSearchTerm('');
    setSearchResults([]);
  };

  const removeProduct = (id: string) => {
    setSelectedProducts(selectedProducts.filter((p) => p.id !== id));
    setComparison(null);
    setCompareError(null);
  };

  const runComparison = async () => {
    if (selectedProducts.length < 2) return;
    setComparing(true);
    setCompareError(null);
    try {
      const res = await fetch('/api/v1/comparison', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productIds: selectedProducts.map((p) => p.id) }),
      });
      const data = await res.json();
      if (data.success) {
        setComparison(data.data);
      } else {
        setCompareError('Comparison could not be loaded. Please try again.');
      }
    } catch {
      setComparison(null);
      setCompareError('Comparison could not be loaded. Please try again.');
    } finally {
      setComparing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <SiteHeader />
      <div className="container mx-auto max-w-6xl px-4 py-8">
        <div className="mb-8 text-center">
          <h1 className="flex items-center justify-center gap-2 text-3xl font-bold sm:text-4xl">
            <GitCompare className="h-8 w-8 text-blue-600" />
            Product Comparison
          </h1>
          <p className="mt-2 text-muted-foreground">
            Compare products across retailers with AI-powered insights
          </p>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Select Products to Compare ({selectedProducts.length}/5)</CardTitle>
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
                  className="pl-10"
                />
              </div>
              <Button onClick={() => searchProducts(searchTerm)} disabled={loading || !searchTerm.trim()}>
                {loading ? <LoadingSpinner size="sm" /> : 'Find'}
              </Button>
            </div>

            {showSearch && !loading && searchResults.length === 0 && (
              <p className="mt-4 text-sm text-muted-foreground">
                No products found for that search. Try a different term.
              </p>
            )}

            {showSearch && searchResults.length > 0 && (
              <div className="mt-4 space-y-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                {searchResults.map((product) => (
                  <button
                    key={product.id}
                    onClick={() => addProduct({ id: product.id, name: product.name, slug: product.slug })}
                    className="flex w-full items-center justify-between rounded-md p-2 text-left transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <div>
                      <span className="font-medium">{product.name}</span>
                      {product.brand && <span className="ml-2 text-sm text-muted-foreground">{product.brand}</span>}
                    </div>
                    <Plus className="h-4 w-4 text-blue-600" />
                  </button>
                ))}
              </div>
            )}

            {selectedProducts.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {selectedProducts.map((product) => (
                  <Badge key={product.id} variant="secondary" className="flex items-center gap-1 py-1.5">
                    {product.name}
                    <button onClick={() => removeProduct(product.id)} className="ml-1 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            {selectedProducts.length >= 2 && (
              <Button onClick={runComparison} disabled={comparing} className="mt-4 w-full">
                {comparing ? <LoadingSpinner size="sm" /> : <GitCompare className="mr-2 h-4 w-4" />}
                Compare {selectedProducts.length} Products
              </Button>
            )}
          </CardContent>
        </Card>

        {comparing && (
          <div className="flex justify-center py-12">
            <LoadingSpinner size="lg" />
          </div>
        )}

        {!comparing && compareError && !comparison && (
          <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {compareError}
          </p>
        )}

        {!comparing && !comparison && selectedProducts.length < 2 && (
          <EmptyState
            title="Select products to compare"
            description="Search and add at least 2 products to see a detailed comparison"
            icon={GitCompare}
          />
        )}

        {comparison && !comparing && (
          <div className="space-y-6">
            <Card className="border-blue-200 bg-gradient-to-r from-blue-50 to-cyan-50 dark:border-blue-800 dark:from-blue-950 dark:to-cyan-950">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-yellow-500" />
                  AI Comparison Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed">{comparison.aiSummary}</p>
              </CardContent>
            </Card>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b-2 border-slate-200 dark:border-slate-700">
                    <th className="p-3 text-left text-sm font-medium text-muted-foreground">Feature</th>
                    {comparison.products.map((p) => (
                      <th key={p.productId} className="p-3 text-left">
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
                    <td className="p-3 text-sm font-medium">Best Price</td>
                    {comparison.products.map((p) => {
                      const prices = p.retailers.map((r) => r.price);
                      const minPrice = prices.length > 0 ? Math.min(...prices) : null;
                      const allPrices = comparison.products.flatMap((p2) => p2.retailers.map((r) => r.price));
                      const overallMin = allPrices.length > 0 ? Math.min(...allPrices) : null;
                      return (
                        <td key={p.productId} className="p-3">
                          {minPrice !== null ? (
                            <span className={cn('font-bold', minPrice === overallMin ? 'text-green-600' : '')}>
                              <Price usd={minPrice} />
                            </span>
                          ) : (
                            <span className="text-sm text-muted-foreground">No listings</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <td className="p-3 text-sm font-medium">Rating</td>
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
                    <td className="p-3 text-sm font-medium">Reviews</td>
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
                    <td className="p-3 text-sm font-medium">Availability</td>
                    {comparison.products.map((p) => (
                      <td key={p.productId} className="p-3">
                        <Badge variant={p.retailers.some((r) => r.availability === 'in_stock') ? 'default' : 'destructive'}>
                          {p.retailers.some((r) => r.availability === 'in_stock') ? 'In Stock' : 'Out of Stock'}
                        </Badge>
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <td className="p-3 text-sm font-medium">Retailers</td>
                    {comparison.products.map((p) => (
                      <td key={p.productId} className="p-3 text-sm">
                        {p.retailers.length} retailer{p.retailers.length !== 1 ? 's' : ''}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="p-3 text-sm font-medium">Actions</td>
                    {comparison.products.map((p) => (
                      <td key={p.productId} className="p-3">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => router.push(`/products/${p.slug || p.productId}`)}
                        >
                          View Details
                        </Button>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Summary banner (Option 14-B): deterministic badges
                earned from real specs/prices only — renders nothing
                when no badge is earned. */}
            <ComparisonSummaryBanner products={comparison.products} />

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
              }))}
            />

            {/* Option 16: repairability + regret risk per product.
                SpecTradeoffTable stays on the product page — the
                comparison API carries no spec rows (SpecMatrix above
                already covers specs here). */}
            <div>
              <h3 className="mb-3 text-lg font-semibold">Repairability &amp; Regret Risk</h3>
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
              <h3 className="mb-3 text-lg font-semibold">
                Hardware Endurance &amp; Sustainability
              </h3>
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
              <h3 className="mb-3 text-lg font-semibold">Weight &amp; Power</h3>
              <div className="grid gap-6 lg:grid-cols-2">
                {comparison.products.map((p) => (
                  <div key={p.productId} className="space-y-6">
                    <WeightPowerCard physical={p.physical ?? null} title={p.name} />
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
