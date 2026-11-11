'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShoppingBasket, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { Price } from '@/components/region/price';
import { cn } from '@/lib/utils';
import type { BundleResult } from '@/services/bundle-allocator';

interface BundlesDiscovery {
  availableCategories: string[];
  productCount: number;
}

function uncoveredReasonText(reason: string): string {
  return reason === 'no-priced-product'
    ? 'No priced product in this category yet'
    : 'Does not fit the remaining budget';
}

/**
 * Budget-to-Cart Allocator UI — Enterprise feature #4.
 *
 * The user enters a total budget and picks categories; the server
 * runs the deterministic allocator over the real catalog. Every
 * pick shows its recorded lowest merchant price, the total never
 * exceeds the budget, and uncovered categories say exactly why.
 */
export function BundleAllocator() {
  const router = useRouter();
  const [categories, setCategories] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [budget, setBudget] = useState('');
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [building, setBuilding] = useState(false);
  const [result, setResult] = useState<BundleResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/v1/bundles');
        const data = await res.json();
        if (!cancelled && data.success) {
          const discovery = data.data as BundlesDiscovery;
          setCategories(discovery.availableCategories ?? []);
        }
      } catch {
        if (!cancelled) setCategories([]);
      } finally {
        if (!cancelled) setLoadingCategories(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleCategory = (category: string) => {
    setSelected((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]
    );
  };

  const buildBundle = async () => {
    const budgetUsd = Number(budget);
    if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
      setError('Enter a budget above $0.');
      return;
    }
    if (selected.length === 0) {
      setError('Choose at least one category.');
      return;
    }
    setBuilding(true);
    setError(null);
    setResult(null);
    try {
      const params = new URLSearchParams({
        budget: String(budgetUsd),
        categories: selected.join(','),
      });
      const res = await fetch(`/api/v1/bundles?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setResult(data.data as BundleResult);
      } else {
        setError(data.error?.message ?? 'The bundle could not be built. Please try again.');
      }
    } catch {
      setError('The bundle could not be built. Please try again.');
    } finally {
      setBuilding(false);
    }
  };

  const remaining =
    result !== null ? Math.round((result.budgetUsd - result.totalSpendUsd) * 100) / 100 : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-5 w-5 text-blue-600" />
            Your budget &amp; categories
          </CardTitle>
          <CardDescription>
            Pick a total budget and the categories you need. The allocator covers as many
            categories as fit, at the lowest recorded prices.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label htmlFor="bundle-budget" className="mb-1 block text-sm font-medium">
              Total budget (USD)
            </label>
            <Input
              id="bundle-budget"
              type="number"
              min="1"
              step="1"
              inputMode="decimal"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="e.g. 1500"
            />
          </div>

          <div>
            <span className="mb-2 block text-sm font-medium">Categories</span>
            {loadingCategories ? (
              <LoadingSpinner size="sm" />
            ) : categories.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No categories are available right now. Please try again later.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {categories.map((category) => (
                  <Button
                    key={category}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => toggleCategory(category)}
                    aria-pressed={selected.includes(category)}
                    className={cn(
                      'h-auto rounded-full px-3 py-1.5 text-sm transition-colors',
                      selected.includes(category)
                        ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-600 hover:text-white'
                        : 'hover:border-blue-400'
                    )}
                  >
                    {category}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              {error}
            </p>
          )}

          <Button
            onClick={buildBundle}
            disabled={building || selected.length === 0 || !budget.trim()}
            className="w-full"
          >
            {building ? <LoadingSpinner size="sm" /> : <ShoppingBasket className="mr-2 h-4 w-4" />}
            Build my bundle
          </Button>
        </CardContent>
      </Card>

      {result && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Your bundle — {result.coveredCategories.length} of {result.coveredCategories.length + result.uncovered.length} categories covered
              </CardTitle>
              <CardDescription>
                Total <Price usd={result.totalSpendUsd} /> of <Price usd={result.budgetUsd} /> budget
                {remaining !== null && remaining > 0 && (
                  <> · <Price usd={remaining} /> left over</>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {result.picks.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing fits this budget. Try a higher budget or fewer categories.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {result.picks.map((pick) => (
                    <li key={pick.id} className="flex items-center justify-between gap-3 py-3">
                      <div>
                        <Button
                          type="button"
                          variant="link"
                          onClick={() => router.push(`/products/${pick.slug}`)}
                          className="h-auto justify-start p-0 font-medium text-inherit hover:text-inherit"
                        >
                          {pick.name}
                        </Button>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span>{pick.category}</span>
                          {pick.brand && <span>{pick.brand}</span>}
                        </div>
                      </div>
                      <span className="font-bold">
                        <Price usd={pick.priceUsd} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {result.uncovered.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Not covered</CardTitle>
                <CardDescription>These categories got no product — here is exactly why.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {result.uncovered.map((item) => (
                    <li key={item.category} className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium">{item.category}</span>
                      <Badge variant="secondary">{uncoveredReasonText(item.reason)}</Badge>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
