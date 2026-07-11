'use client';

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
  name: string;
  brand: string | null;
  image: string | null;
  retailers: ComparisonRetailer[];
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

  const searchProducts = useCallback(async (term: string) => {
    if (!term.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/products?search=${encodeURIComponent(term)}&pageSize=10`);
      const data = await res.json();
      if (data.success) {
        setSearchResults(data.data.products ?? []);
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
  };

  const runComparison = async () => {
    if (selectedProducts.length < 2) return;
    setComparing(true);
    try {
      const res = await fetch('/api/v1/comparison', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productIds: selectedProducts.map((p) => p.id) }),
      });
      const data = await res.json();
      if (data.success) {
        setComparison(data.data);
      }
    } catch {
      setComparison(null);
    } finally {
      setComparing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
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
                          {minPrice !== null && (
                            <span className={cn('font-bold', minPrice === overallMin ? 'text-green-600' : '')}>
                              ${minPrice.toFixed(2)}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <td className="p-3 text-sm font-medium">Rating</td>
                    {comparison.products.map((p) => {
                      const rating = p.retailers[0]?.rating;
                      return (
                        <td key={p.productId} className="p-3">
                          {rating !== null && rating !== undefined ? (
                            <span className="flex items-center gap-1">
                              <span className="font-semibold">{rating.toFixed(1)}</span>
                              <span className="text-xs text-muted-foreground">★</span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <td className="p-3 text-sm font-medium">Reviews</td>
                    {comparison.products.map((p) => (
                      <td key={p.productId} className="p-3 text-sm">
                        {p.retailers[0]?.reviewCount ?? 0}
                      </td>
                    ))}
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
                          onClick={() => router.push(`/products/${p.productId}`)}
                        >
                          View Details
                        </Button>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
