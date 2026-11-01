'use client';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search, SlidersHorizontal, X, Star, TrendingDown, Link2, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { WishlistButton } from '@/components/products/wishlist-button';
import { PriceAlertDialog } from '@/components/products/price-alert-dialog';
import type { WebSearchResult } from '@/types/ai';

interface SearchResult {
  product: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    brand: string | null;
    category: string | null;
    imageUrl: string | null;
    confidenceScore: number;
  };
  score: number;
  matchedAttributes: string[];
  aiExplanation: string;
  currentPrice: number | null;
  stores: string[];
  rating: number | null;
  ratingCount: number;
}

interface ParsedIntent {
  category: string | null;
  budget: number | null;
  budgetCurrency?: string | null;
  budgetOriginal?: number | null;
  brands: string[];
  intent: string;
}

const SUGGESTED_QUERIES = [
  'Best gaming laptop under $1000',
  'Best camera for YouTube',
  'Best phone battery life',
  'Best budget smartwatch',
  'Best noise cancelling headphones under $200',
];

export default function SearchPage() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [searchMode, setSearchMode] = useState<'text' | 'url'>('text');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [webResults, setWebResults] = useState<WebSearchResult[]>([]);
  const [webSource, setWebSource] = useState<'catalog' | 'web' | 'web-disabled' | null>(null);
  const [parsedIntent, setParsedIntent] = useState<ParsedIntent | null>(null);
  // Image URLs that failed to load (e.g. the Lenovo product photo):
  // those cards render the placeholder icon instead of a blank or
  // broken-image box, the same fallback ProductCard already uses.
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [filters, setFilters] = useState({
    category: '',
    brand: '',
    budgetMax: '',
    minRating: '',
  });
  // Client-side sort + store filter (applied to the results already
  // fetched, so they work instantly and identically for catalog and
  // web results). The panel's Min Rating is also applied here:
  // the ai-search API never accepted it, so the old panel control
  // silently did nothing — now it filters by the rating fields the
  // API returns (catalog) or SerpAPI reports (web).
  const [sort, setSort] = useState<'relevance' | 'price-asc' | 'price-desc' | 'match-desc'>('relevance');
  const [storeFilter, setStoreFilter] = useState('');
  // Opt-in live web prices: when on, the ai-search route also
  // fetches Google Shopping results even when the catalog has
  // matches. Off by default to protect the small SerpAPI free
  // quota; repeat queries are served from the 24h/7d cache.
  const [liveWeb, setLiveWeb] = useState(false);
  // Recent searches: localStorage only, so guests get them too
  // without an account. The signed-in DB search_history (recorded
  // by the ai-search API) is separate analytics, not this UI list.
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('smartbuy-recent-searches');
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      if (Array.isArray(parsed)) {
        setRecentSearches(parsed.filter((q): q is string => typeof q === 'string').slice(0, 8));
      }
    } catch {
      // Corrupt or unavailable storage must never break search.
    }
  }, []);
  const saveRecentSearch = useCallback((searchQuery: string) => {
    const trimmed = searchQuery.trim();
    if (!trimmed) return;
    setRecentSearches((prev) => {
      const next = [trimmed, ...prev.filter((q) => q.toLowerCase() !== trimmed.toLowerCase())].slice(0, 8);
      try {
        window.localStorage.setItem('smartbuy-recent-searches', JSON.stringify(next));
      } catch {
        // Storage full/blocked: the in-memory list still works.
      }
      return next;
    });
  }, []);
  const clearRecentSearches = useCallback(() => {
    setRecentSearches([]);
    try {
      window.localStorage.removeItem('smartbuy-recent-searches');
    } catch {
      // Ignore storage errors.
    }
  }, []);

  const performSearch = useCallback(async (searchQuery: string, mode?: 'text' | 'url') => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    setHasSearched(true);
    // Callers that switch mode in the same click (recent-search
    // chips) pass the mode explicitly: reading searchMode state
    // here would still see the pre-click value.
    const effectiveMode = mode ?? searchMode;

    try {
      const body: Record<string, unknown> = { pageSize: 20 };

      if (effectiveMode === 'url') {
        body.url = searchQuery;
      } else {
        body.query = searchQuery;
      }

      const filterObj: Record<string, unknown> = {};
      if (filters.category) filterObj.category = filters.category;
      if (filters.brand) filterObj.brand = filters.brand;
      if (filters.budgetMax) filterObj.budgetMax = parseFloat(filters.budgetMax);
      if (Object.keys(filterObj).length > 0) body.filters = filterObj;
      if (liveWeb) body.includeWeb = true;

      const res = await fetch('/api/v1/ai-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (data.success) {
        // ai-search API returns the results array directly in `data`
        // (meta holds total/parsedIntent). Accept the object shape too so
        // a future API change cannot silently empty the results again.
        if (effectiveMode === 'text') saveRecentSearch(searchQuery);
        setResults(Array.isArray(data.data) ? data.data : (data.data?.results ?? []));
        // Web fallback results arrive separately in meta.webResults,
        // only when the catalog returned nothing. They are NOT catalog
        // products, so they are kept in their own state and rendered
        // as "Web result" cards with a retailer link below.
        setWebResults(Array.isArray(data.meta?.webResults) ? data.meta.webResults : []);
        setWebSource(data.meta?.source ?? null);
        setParsedIntent(data.meta?.parsedIntent ?? null);
      } else {
        setResults([]);
        setWebResults([]);
        setWebSource(null);
        setParsedIntent(null);
      }
    } catch {
      setResults([]);
      setWebResults([]);
      setWebSource(null);
      setParsedIntent(null);
    } finally {
      setLoading(false);
    }
  }, [filters, searchMode, liveWeb]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    performSearch(query);
  };

  const handleSuggestedQuery = (q: string) => {
    setQuery(q);
    performSearch(q);
  };

  const handleProductClick = (slug: string) => {
    router.push(`/products/${slug}`);
  };

  const intentBadges = useMemo(() => {
    if (!parsedIntent) return null;
    const badges: string[] = [];
    if (parsedIntent.category) badges.push(`Category: ${parsedIntent.category}`);
    if (parsedIntent.budget) {
      // Show what the user actually wrote, with the USD conversion
      // marked approximate (rates are static approximations): e.g.
      // "Budget: 20,000 PKR (≈ $71)" — never a bare "$20000" for a
      // PKR query, which was the reported bug.
      if (
        parsedIntent.budgetCurrency &&
        parsedIntent.budgetCurrency !== 'USD' &&
        parsedIntent.budgetOriginal !== null &&
        parsedIntent.budgetOriginal !== undefined
      ) {
        const original = Number.isInteger(parsedIntent.budgetOriginal)
          ? parsedIntent.budgetOriginal.toLocaleString('en-US')
          : parsedIntent.budgetOriginal.toLocaleString('en-US', { maximumFractionDigits: 2 });
        badges.push(`Budget: ${original} ${parsedIntent.budgetCurrency} (≈ $${parsedIntent.budget})`);
      } else {
        badges.push(`Budget: $${parsedIntent.budget}`);
      }
    }
    if (parsedIntent.brands.length > 0) badges.push(`Brands: ${parsedIntent.brands.join(', ')}`);
    if (parsedIntent.intent && parsedIntent.intent !== 'general') badges.push(`Intent: ${parsedIntent.intent}`);
    return badges.length > 0 ? badges : null;
  }, [parsedIntent]);

  // Stores present in the current result set (catalog merchant
  // names + web result sources), for the store filter dropdown.
  const storeOptions = useMemo(() => {
    const stores = new Set<string>();
    for (const r of results) for (const s of r.stores ?? []) stores.add(s);
    for (const w of webResults) if (w.source) stores.add(w.source);
    return Array.from(stores).sort((a, b) => a.localeCompare(b));
  }, [results, webResults]);

  const minRatingValue = filters.minRating ? parseFloat(filters.minRating) : null;

  const applySort = useCallback(
    <T extends { currentPrice?: number | null; price?: number | null; score?: number }>(items: T[]): T[] => {
      const sorted = [...items];
      const priceOf = (item: T): number | null => {
        if (typeof item.currentPrice === 'number') return item.currentPrice;
        if (typeof item.price === 'number') return item.price;
        return null;
      };
      switch (sort) {
        case 'price-asc':
          // Unpriced items last: they cannot be ordered by price.
          return sorted.sort((a, b) => {
            const pa = priceOf(a);
            const pb = priceOf(b);
            if (pa === null && pb === null) return 0;
            if (pa === null) return 1;
            if (pb === null) return -1;
            return pa - pb;
          });
        case 'price-desc':
          return sorted.sort((a, b) => {
            const pa = priceOf(a);
            const pb = priceOf(b);
            if (pa === null && pb === null) return 0;
            if (pa === null) return 1;
            if (pb === null) return -1;
            return pb - pa;
          });
        case 'match-desc':
          return sorted.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        default:
          return sorted;
      }
    },
    [sort]
  );

  const displayedResults = useMemo(() => {
    let items = results;
    if (storeFilter) items = items.filter((r) => (r.stores ?? []).includes(storeFilter));
    if (minRatingValue !== null) {
      items = items.filter((r) => r.rating !== null && r.rating !== undefined && r.rating >= minRatingValue);
    }
    return applySort(items);
  }, [results, storeFilter, minRatingValue, applySort]);

  const displayedWebResults = useMemo(() => {
    let items = webResults;
    if (storeFilter) items = items.filter((w) => w.source === storeFilter);
    if (minRatingValue !== null) {
      items = items.filter((w) => w.rating !== null && w.rating >= minRatingValue);
    }
    return applySort(items);
  }, [webResults, storeFilter, minRatingValue, applySort]);

  const clientFiltersActive =
    sort !== 'relevance' || storeFilter !== '' || filters.minRating !== '';

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <SiteHeader />
      <div className="container mx-auto max-w-6xl px-4 py-8">
        <div className="mb-8 text-center">
          <h1 className="bg-gradient-to-r from-blue-600 to-cyan-600 dark:from-blue-400 dark:to-cyan-400 bg-clip-text text-3xl font-bold text-transparent sm:text-4xl">
            AI Product Search
          </h1>
          <p className="mt-2 text-muted-foreground">
            Search in natural language — our AI understands what you need
          </p>
        </div>

        <form onSubmit={handleSearch} className="mb-6">
          <div className="mb-3 flex gap-2">
            <button
              type="button"
              onClick={() => setSearchMode('text')}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-all',
                searchMode === 'text'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400'
              )}
            >
              <Search className="h-4 w-4" /> Text Search
            </button>
            <button
              type="button"
              onClick={() => setSearchMode('url')}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-all',
                searchMode === 'url'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400'
              )}
            >
              <Link2 className="h-4 w-4" /> URL Search
            </button>
          </div>

          <div className="flex gap-2">
            <div className="relative flex-1">
              {searchMode === 'text' ? (
                <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              ) : (
                <Link2 className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              )}
              <Input
                type={searchMode === 'url' ? 'url' : 'text'}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchMode === 'url' ? 'Paste a product URL (e.g. https://...)' : 'e.g. Best gaming laptop under $1000'}
                className="pl-10"
                autoFocus
              />
            </div>
            <Button type="submit" disabled={loading || !query.trim()}>
              {loading ? <LoadingSpinner size="sm" /> : 'Search'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowFilters(!showFilters)}
            >
              <SlidersHorizontal className="mr-2 h-4 w-4" />
              Filters
            </Button>
          </div>
        </form>

        {recentSearches.length > 0 && (
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
              <History className="h-4 w-4" /> Recent searches:
            </span>
            {recentSearches.map((recent) => (
              <button
                key={recent}
                type="button"
                onClick={() => {
                  setQuery(recent);
                  setSearchMode('text');
                  performSearch(recent, 'text');
                }}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm transition-all hover:border-blue-300 hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-blue-700 dark:hover:bg-slate-700"
              >
                {recent}
              </button>
            ))}
            <button
              type="button"
              onClick={clearRecentSearches}
              className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          </div>
        )}

        {showFilters && (
          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Search Filters</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFilters({ category: '', brand: '', budgetMax: '', minRating: '' });
                    setSort('relevance');
                    setStoreFilter('');
                    setLiveWeb(false);
                  }}
                >
                  <X className="mr-1 h-4 w-4" /> Clear
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <Label className="mb-1.5 block text-sm">Sort by</Label>
                  <Select
                    value={sort}
                    onValueChange={(v) => setSort(v as 'relevance' | 'price-asc' | 'price-desc' | 'match-desc')}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Relevance" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="relevance">Relevance</SelectItem>
                      <SelectItem value="price-asc">Price: Low to High</SelectItem>
                      <SelectItem value="price-desc">Price: High to Low</SelectItem>
                      <SelectItem value="match-desc">Best Match</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-sm">Store</Label>
                  <Select
                    value={storeFilter || 'all'}
                    onValueChange={(v) => setStoreFilter(v === 'all' ? '' : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All stores" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All stores</SelectItem>
                      {storeOptions.map((store) => (
                        <SelectItem key={store} value={store}>
                          {store}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-sm">Category</Label>
                  <Input
                    value={filters.category}
                    onChange={(e) => setFilters({ ...filters, category: e.target.value })}
                    placeholder="e.g. laptop"
                  />
                </div>
                <div>
                  <Label className="mb-1.5 block text-sm">Brand</Label>
                  <Input
                    value={filters.brand}
                    onChange={(e) => setFilters({ ...filters, brand: e.target.value })}
                    placeholder="e.g. Apple"
                  />
                </div>
                <div>
                  <Label className="mb-1.5 block text-sm">Max Budget ($)</Label>
                  <Input
                    type="number"
                    value={filters.budgetMax}
                    onChange={(e) => setFilters({ ...filters, budgetMax: e.target.value })}
                    placeholder="e.g. 1000"
                  />
                </div>
                <div>
                  <Label className="mb-1.5 block text-sm">Min Rating</Label>
                  <Select
                    value={filters.minRating || 'any'}
                    onValueChange={(v) => setFilters({ ...filters, minRating: v === 'any' ? '' : v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Any rating" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any rating</SelectItem>
                      <SelectItem value="3">3+ stars</SelectItem>
                      <SelectItem value="4">4+ stars</SelectItem>
                      <SelectItem value="4.5">4.5+ stars</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={liveWeb}
                  onChange={(e) => setLiveWeb(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">Live web prices bhi dikhao</span>
                  <span className="block text-xs text-muted-foreground">
                    Catalog ke saath Google Shopping ke live results bhi laaye jaayenge — taake aap dekh saken ke
                    bahar market mein kya price chal rahi hai. Repeat searches cache se aati hain, is liye quota
                    bachta hai. (Needs a SerpAPI key in Netlify; warna sirf catalog dikhega.)
                  </span>
                </span>
              </label>
            </CardContent>
          </Card>
        )}

        {!hasSearched && !loading && (
          <div className="mb-8">
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">Try these searches:</h2>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED_QUERIES.map((q) => (
                <button
                  key={q}
                  onClick={() => handleSuggestedQuery(q)}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm transition-all hover:border-blue-300 hover:bg-blue-50 hover:shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:hover:border-blue-700 dark:hover:bg-slate-700"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {intentBadges && (
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">AI understood:</span>
            {intentBadges.map((badge, i) => (
              <Badge key={i} variant="secondary" className="bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                {badge}
              </Badge>
            ))}
          </div>
        )}

        {loading && (
          <div className="grid gap-4" aria-label="Loading search results">
            <p className="text-sm text-muted-foreground">
              Searching our catalog — and live web results next if the catalog has nothing…
            </p>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-lg border p-4">
                <div className="flex gap-4">
                  <div className="h-24 w-24 flex-shrink-0 rounded-lg bg-slate-100 dark:bg-slate-800" />
                  <div className="flex-1 space-y-3 py-1">
                    <div className="h-4 w-1/2 rounded bg-slate-100 dark:bg-slate-800" />
                    <div className="h-3 w-3/4 rounded bg-slate-100 dark:bg-slate-800" />
                    <div className="h-3 w-1/3 rounded bg-slate-100 dark:bg-slate-800" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && hasSearched && displayedResults.length === 0 && displayedWebResults.length === 0 && (
          <>
            {results.length > 0 || webResults.length > 0 ? (
              <EmptyState
                title="No results match your filters"
                description="Products were found, but none match the sort, store, or rating filters you selected. Clear the filters to see everything again."
                icon={Search}
              />
            ) : (
              <EmptyState
                title="No results found"
                description={
                  webSource === 'web-disabled'
                    ? 'We searched our catalog and found nothing for this query. Live web search is not configured yet (it needs a SerpAPI key in Netlify), so no web fallback ran. Try a broader product name, check the spelling, or clear your filters.'
                    : 'We searched our catalog and, when it had nothing, live web shopping results too — and found nothing for this query. Try a broader product name, check the spelling, remove a budget limit, or clear your filters.'
                }
                icon={Search}
              />
            )}
            {(clientFiltersActive || filters.category || filters.brand || filters.budgetMax) && (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="outline"
                  onClick={() => {
                    setFilters({ category: '', brand: '', budgetMax: '', minRating: '' });
                    setSort('relevance');
                    setStoreFilter('');
                    setLiveWeb(false);
                  }}
                >
                  Clear all filters
                </Button>
              </div>
            )}
          </>
        )}

        {!loading && displayedResults.length > 0 && (
          <div className="grid gap-4">
            <div className="text-sm text-muted-foreground">
              {displayedResults.length} result{displayedResults.length !== 1 ? 's' : ''} found
              {displayedResults.length !== results.length && ` (of ${results.length} before filters)`}
            </div>
            {displayedResults.map((result) => (
              <Card
                key={result.product.id}
                className="cursor-pointer transition-all hover:shadow-lg hover:border-blue-200 dark:hover:border-blue-800"
                onClick={() => handleProductClick(result.product.slug)}
              >
                <CardContent className="flex gap-4 p-4">
                  <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                    {result.product.imageUrl && !failedImages.has(result.product.id) ? (
                      <img
                        src={result.product.imageUrl}
                        alt={result.product.name}
                        className="h-full w-full object-cover"
                        onError={() =>
                          setFailedImages((prev) => new Set(prev).add(result.product.id))
                        }
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <Search className="h-8 w-8" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-semibold text-lg leading-tight">{result.product.name}</h3>
                        <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                          {result.product.brand && <span>{result.product.brand}</span>}
                          {result.product.category && (
                            <>
                              <span>·</span>
                              <span>{result.product.category}</span>
                            </>
                          )}
                          {result.rating !== null && result.rating !== undefined && (
                            <>
                              <span>·</span>
                              <span>★ {result.rating.toFixed(1)} ({result.ratingCount} review{result.ratingCount !== 1 ? 's' : ''})</span>
                            </>
                          )}
                        </div>
                        {result.stores && result.stores.length > 0 && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Available at: {result.stores.join(', ')}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {result.currentPrice !== null && result.currentPrice !== undefined ? (
                          <span className="text-lg font-bold text-blue-600">
                            ${result.currentPrice.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Price not listed</span>
                        )}
                        <Badge className="bg-blue-600">
                          {Math.round(result.score)}% match
                        </Badge>
                        {result.matchedAttributes.includes('budget') && (
                          <Badge variant="outline" className="text-green-600 border-green-300">
                            <TrendingDown className="mr-1 h-3 w-3" />
                            In budget
                          </Badge>
                        )}
                      </div>
                    </div>
                    {result.product.description && (
                      <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
                        {result.product.description}
                      </p>
                    )}
                    <div className="mt-2 flex items-start gap-1.5 rounded-md bg-blue-50 p-2 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                      <Star className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                      <span>{result.aiExplanation}</span>
                    </div>
                    {/* Save / alert from the card itself — previously
                        these only existed on the product page, so a
                        shopper had to open every product first. The
                        wrapper stops the click so it does not also
                        navigate to the product page; guests get the
                        dialogs' own sign-in prompt, not a dead end. */}
                    <div
                      className="mt-3 flex flex-wrap gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <WishlistButton
                        productId={result.product.id}
                        productName={result.product.name}
                        variant="outline"
                        size="sm"
                      />
                      <PriceAlertDialog
                        productId={result.product.id}
                        productName={result.product.name}
                        currentPrice={result.currentPrice}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Web fallback results — only when the catalog had nothing.
            These are NOT SmartBuy catalog products: no Deal Score, no
            price history, no product page. Prices come from Google
            Shopping via SerpAPI and may change at the retailer, so
            each card links out to the retailer instead of inventing
            specs or a SmartBuy price record. */}
        {!loading && displayedWebResults.length > 0 && (
          <div className="mt-8 grid gap-4">
            <div>
              <h2 className="text-lg font-semibold">{liveWeb ? 'Live web results' : 'Web results'}</h2>
              <p className="text-sm text-muted-foreground">
                {liveWeb
                  ? 'Live Google Shopping results alongside our catalog — prices may change at the retailer; full specs are on the retailer page.'
                  : 'Not in our catalog yet — live shopping results from the web. Prices may change at the retailer; full specs are on the retailer page.'}
                {displayedWebResults.length !== webResults.length && ` Showing ${displayedWebResults.length} of ${webResults.length} after filters.`}
              </p>
            </div>
            {displayedWebResults.map((web) => (
              <a
                key={web.id}
                href={web.link}
                target="_blank"
                rel="noopener noreferrer"
                className="block"
              >
                <Card className="transition-all hover:shadow-lg hover:border-blue-200 dark:hover:border-blue-800">
                  <CardContent className="flex gap-4 p-4">
                    <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                      {web.thumbnail ? (
                        <img
                          src={web.thumbnail}
                          alt={web.title}
                          className="h-full w-full object-cover"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                          <Search className="h-8 w-8" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold text-lg leading-tight">{web.title}</h3>
                        <Badge variant="secondary" className="shrink-0 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                          Web result
                        </Badge>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                        {web.source && <span>{web.source}</span>}
                        {web.rating !== null && (
                          <span>
                            ★ {web.rating.toFixed(1)}
                            {web.reviews !== null ? ` (${web.reviews} reviews)` : ''}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex items-center gap-3">
                        {web.price !== null ? (
                          <span className="text-lg font-bold text-blue-600">
                            ${web.price.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">Price not shown by retailer</span>
                        )}
                        <span className="text-xs text-blue-600 underline">View at retailer →</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </a>
            ))}
          </div>
        )}
      </div>
      <SiteFooter />
    </div>
  );
}
