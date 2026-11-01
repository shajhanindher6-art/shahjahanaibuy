'use client';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';

import { useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Search, SlidersHorizontal, X, Star, TrendingDown, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
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
}

interface ParsedIntent {
  category: string | null;
  budget: number | null;
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
  const [loading, setLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [filters, setFilters] = useState({
    category: '',
    brand: '',
    budgetMax: '',
    minRating: '',
  });

  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    setHasSearched(true);

    try {
      const body: Record<string, unknown> = { pageSize: 20 };

      if (searchMode === 'url') {
        body.url = searchQuery;
      } else {
        body.query = searchQuery;
      }

      const filterObj: Record<string, unknown> = {};
      if (filters.category) filterObj.category = filters.category;
      if (filters.brand) filterObj.brand = filters.brand;
      if (filters.budgetMax) filterObj.budgetMax = parseFloat(filters.budgetMax);
      if (Object.keys(filterObj).length > 0) body.filters = filterObj;

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
  }, [filters, searchMode]);

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
    if (parsedIntent.budget) badges.push(`Budget: $${parsedIntent.budget}`);
    if (parsedIntent.brands.length > 0) badges.push(`Brands: ${parsedIntent.brands.join(', ')}`);
    if (parsedIntent.intent && parsedIntent.intent !== 'general') badges.push(`Intent: ${parsedIntent.intent}`);
    return badges.length > 0 ? badges : null;
  }, [parsedIntent]);

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

        {showFilters && (
          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Search Filters</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setFilters({ category: '', brand: '', budgetMax: '', minRating: '' })}
                >
                  <X className="mr-1 h-4 w-4" /> Clear
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
                    value={filters.minRating}
                    onValueChange={(v) => setFilters({ ...filters, minRating: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Any rating" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Any rating</SelectItem>
                      <SelectItem value="3">3+ stars</SelectItem>
                      <SelectItem value="4">4+ stars</SelectItem>
                      <SelectItem value="4.5">4.5+ stars</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
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
          <div className="flex justify-center py-12">
            <LoadingSpinner size="lg" />
          </div>
        )}

        {!loading && hasSearched && results.length === 0 && webResults.length === 0 && (
          <EmptyState
            title="No results found"
            description={
              webSource === 'web-disabled'
                ? 'Try a different search query or adjust your filters. Note: web search is not configured yet (it needs a SerpAPI key in Netlify), so only our catalog was searched.'
                : 'Try a different search query or adjust your filters — our web search also found nothing for this query.'
            }
            icon={Search}
          />
        )}

        {!loading && results.length > 0 && (
          <div className="grid gap-4">
            <div className="text-sm text-muted-foreground">
              {results.length} result{results.length !== 1 ? 's' : ''} found
            </div>
            {results.map((result) => (
              <Card
                key={result.product.id}
                className="cursor-pointer transition-all hover:shadow-lg hover:border-blue-200 dark:hover:border-blue-800"
                onClick={() => handleProductClick(result.product.slug)}
              >
                <CardContent className="flex gap-4 p-4">
                  <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                    {result.product.imageUrl ? (
                      <img
                        src={result.product.imageUrl}
                        alt={result.product.name}
                        className="h-full w-full object-cover"
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
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
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
        {!loading && webResults.length > 0 && (
          <div className="mt-8 grid gap-4">
            <div>
              <h2 className="text-lg font-semibold">Web results</h2>
              <p className="text-sm text-muted-foreground">
                Not in our catalog yet — live shopping results from the web. Prices may change at the retailer; full specs are on the retailer page.
              </p>
            </div>
            {webResults.map((web) => (
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
