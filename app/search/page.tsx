'use client';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';

import { useState, useCallback, useMemo, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, SlidersHorizontal, X, Star, TrendingDown, Link2, History, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { buildItemListJsonLd, toJsonLd } from '@/lib/json-ld';
import { appConfig } from '@/lib/config/app';
import { WishlistButton } from '@/components/products/wishlist-button';
import { ShareButtons } from '@/components/products/share-buttons';
import { PriceAlertDialog } from '@/components/products/price-alert-dialog';
import { Price } from '@/components/region/price';
import { DealScoreBadge } from '@/components/products/deal-score-badge';
import { PriceTrendSparkline } from '@/components/products/price-trend-sparkline';
import { dealScoreForDisplay } from '@/lib/deal-score';
import {
  VoiceSearchButton,
  speakSearchSummary,
} from '@/components/search/voice-search-button';
import { SearchAutocomplete } from '@/components/search/search-autocomplete';
import { SavedSearches } from '@/components/search/saved-searches';
import { ProductSearchResults } from '@/components/search/product-search-results';
import {
  FEW_SEARCH_RESULTS,
  suggestSearchCorrection,
  type SearchCatalogTokens,
} from '@/lib/search-suggestions';
import type { LocalFirstSearchData } from '@/services/local-first-search';
import { useRegion } from '@/components/region/region-provider';
import { tFor } from '@/lib/i18n';
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
  /** Query tokens this product's text carries (B1) — shown as
      "Matched: …" on the card. Absent on older cached responses. */
  matchedTerms?: string[];
  aiExplanation: string;
  currentPrice: number | null;
  stores: string[];
  rating: number | null;
  ratingCount: number;
}

interface ParsedIntent {
  category: string | null;
  budget: number | null;
  budgetMin?: number | null;
  budgetCurrency?: string | null;
  budgetOriginal?: number | null;
  brands: string[];
  excludedBrands?: string[];
  excludedTerms?: string[];
  attributes?: Record<string, string>;
  intent: string;
}

// Human labels for the description-keyword attribute keys the AI
// search API returns (services/ai-search.ts ATTRIBUTE_LABELS —
// duplicated here instead of importing that server module into
// this client component).
const ATTRIBUTE_BADGE_LABELS: Record<string, string> = {
  battery: 'Long battery',
  weight: 'Lightweight',
  resolution: '4K',
  display: 'OLED',
  waterproof: 'Waterproof',
  ram: 'RAM',
  storage: 'Storage',
  'screen-size': 'Screen size',
  'noise-cancelling': 'Noise cancelling',
  touchscreen: 'Touchscreen',
  '5g': '5G',
  'refresh-rate': 'Refresh rate',
};

const SUGGESTED_QUERIES = [
  'Best gaming laptop under $1000',
  'Best camera for YouTube',
  'Best phone battery life',
  'Best budget smartwatch',
  'Best noise cancelling headphones under $200',
];

function SearchPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { language } = useRegion();
  const [query, setQuery] = useState('');
  // Voice search: set when a spoken transcript starts a search, so the
  // spoken summary below fires exactly once for that search (and never
  // for typed searches or filter changes).
  const voiceSearchRef = useRef(false);
  const voiceLangRef = useRef('en-US');
  // ?q= guard (Section 10, chunk 1): the last query that was
  // searched from the URL (or written to it by performSearch), so
  // the ?q= effect below never re-runs a search that already ran
  // when performSearch's router.replace re-renders the page.
  const lastSearchedRef = useRef<string | null>(null);
  const [searchMode, setSearchMode] = useState<'text' | 'url'>('text');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [webResults, setWebResults] = useState<WebSearchResult[]>([]);
  const [webSource, setWebSource] = useState<'catalog' | 'web' | 'web-disabled' | null>(null);
  const [parsedIntent, setParsedIntent] = useState<ParsedIntent | null>(null);
  // B10: the resolved "X vs Y" pair from the ai-search API, for
  // the "Compare these two" CTA above the results. Empty when the
  // query had no `vs`, or a side could not be resolved.
  const [compareProducts, setCompareProducts] = useState<Array<{ id: string; name: string; slug: string }>>([]);
  // Section 14, Chunk 4 — B1: the server's page / total, from
  // meta (the API slices the page now). The page no longer slices
  // in memory, so these are the numbers the count line and the
  // pager render — page and API agree on page / pageSize / total.
  const [serverTotal, setServerTotal] = useState(0);
  const [serverPage, setServerPage] = useState(1);
  // B4: active deals per product id (from /api/v1/deals/ranked,
  // fetched once per search) — the "On deal" badge on a card.
  // Empty when the fetch fails or nothing is on deal: no badge,
  // never a guessed discount.
  const [dealByProduct, setDealByProduct] = useState<
    Record<string, { discountPercentage: number; savingsAmount: number }>
  >({});
  // Local-first retailer tabs (additive): /api/search splits the
  // same query into local vs global stores for the visitor's
  // country. Kept in its own state so a failure here never
  // disturbs the ai-search results, filters, or sort above.
  const [localFirst, setLocalFirst] = useState<LocalFirstSearchData | null>(null);
  const [localFirstLoading, setLocalFirstLoading] = useState(false);
  const [localFirstError, setLocalFirstError] = useState(false);
  // Image URLs that failed to load (e.g. the Lenovo product photo):
  // those cards render the placeholder icon instead of a blank or
  // broken-image box, the same fallback ProductCard already uses.
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  // Distinct failure state: the old code collapsed a failed fetch
  // (network error, or a !success API response) into "No results
  // found", telling the shopper the catalog had nothing when the
  // search itself had failed. A failure now says so, with a retry.
  const [searchError, setSearchError] = useState(false);
  // Section 11, Chunk C: the query the visitor explicitly saved from
  // the no-results empty state (via saveRecentSearch below, the same
  // device-only list shown under Recent searches). Compared against
  // the current query so the button resets itself for a new search.
  const [savedSearch, setSavedSearch] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  // Section 13, Chunk A — URL state: every search control is reflected
  // in the URL (?q=&sort=&store=&category=&brand=&max=&minRating=
  // &band=&page=), so refresh / share / back keeps the exact search.
  // State initializes from the URL, so a shared link replays the
  // same filters, sort and page.
  const [filters, setFilters] = useState({
    category: searchParams.get('category') ?? '',
    brand: searchParams.get('brand') ?? '',
    budgetMax: searchParams.get('max') ?? '',
    minRating: searchParams.get('minRating') ?? '',
  });
  // Client-side sort + store filter (applied to the results already
  // fetched, so they work instantly and identically for catalog and
  // web results). The panel's Min Rating is also applied here:
  // the ai-search API never accepted it, so the old panel control
  // silently did nothing — now it filters by the rating fields the
  // API returns (catalog) or SerpAPI reports (web).
  // Section 13: sort / store / price-band / page state, initialized
  // from the URL (see the note on `filters` above).
  // Section 14, Chunk 4 — B1/B6: sort, store, rating and band are
  // SERVER filters/sort now (the ai-search API applies them before
  // slicing the page). The state below still drives the panel and
  // the URL; changing one re-runs the search (see the handlers).
  // 'rating-desc' (B6) sorts by the average rating the API returns.
  type SearchSortKey = 'relevance' | 'price-asc' | 'price-desc' | 'match-desc' | 'deal-score' | 'rating-desc';
  type PriceBand = 'all' | 'under-100' | '100-500' | '500-plus';
  const SORT_KEYS: SearchSortKey[] = ['relevance', 'price-asc', 'price-desc', 'match-desc', 'deal-score', 'rating-desc'];
  const PRICE_BANDS: PriceBand[] = ['all', 'under-100', '100-500', '500-plus'];
  /** Server page size (10) — the request and the pager share it. */
  const SEARCH_PAGE_SIZE = 10;
  const [sort, setSort] = useState<SearchSortKey>(() => {
    const v = searchParams.get('sort');
    return v !== null && (SORT_KEYS as string[]).includes(v) ? (v as SearchSortKey) : 'relevance';
  });
  const [storeFilter, setStoreFilter] = useState(() => searchParams.get('store') ?? '');
  const [priceBand, setPriceBand] = useState<PriceBand>(() => {
    const v = searchParams.get('band');
    return v !== null && (PRICE_BANDS as string[]).includes(v) ? (v as PriceBand) : 'all';
  });
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page') ?? 1) || 1));

  // Mirror of the URL-visible state, read by writeSearchUrl so the
  // performSearch useCallback never writes a stale sort / store /
  // band when the search was triggered from an older render.
  const urlStateRef = useRef({
    query: '',
    sort: 'relevance' as SearchSortKey,
    store: '',
    category: '',
    brand: '',
    budgetMax: '',
    minRating: '',
    band: 'all' as PriceBand,
    page: 1,
  });
  urlStateRef.current = {
    query,
    sort,
    store: storeFilter,
    category: filters.category,
    brand: filters.brand,
    budgetMax: filters.budgetMax,
    minRating: filters.minRating,
    band: priceBand,
    page,
  };

  // Write the full search state into the URL (defaults omitted, so a
  // plain search is still just /search?q=…). router.replace, not
  // push: filter tweaks must not flood the back-button history.
  const writeSearchUrl = useCallback(
    (patch: {
      q?: string;
      sort?: SearchSortKey;
      store?: string;
      category?: string;
      brand?: string;
      max?: string;
      minRating?: string;
      band?: PriceBand;
      page?: number;
    }) => {
      const s = urlStateRef.current;
      const q = patch.q !== undefined ? patch.q : s.query;
      const sortV = patch.sort ?? s.sort;
      const storeV = patch.store ?? s.store;
      const categoryV = patch.category ?? s.category;
      const brandV = patch.brand ?? s.brand;
      const maxV = patch.max ?? s.budgetMax;
      const minRatingV = patch.minRating ?? s.minRating;
      const bandV = patch.band ?? s.band;
      const pageV = patch.page ?? s.page;
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (sortV !== 'relevance') params.set('sort', sortV);
      if (storeV) params.set('store', storeV);
      if (categoryV) params.set('category', categoryV);
      if (brandV) params.set('brand', brandV);
      if (maxV) params.set('max', maxV);
      if (minRatingV) params.set('minRating', minRatingV);
      if (bandV !== 'all') params.set('band', bandV);
      if (pageV > 1) params.set('page', String(pageV));
      const qs = params.toString();
      router.replace(qs ? `/search?${qs}` : '/search');
    },
    [router]
  );
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

  // S2#10: canonical Deal Scores for the displayed results, from
  // GET /api/v1/predictions/[id] — the same prediction the product
  // page scores from (lib/deal-score.ts). The search API returns no
  // prediction data, so scores are fetched per displayed result
  // (not per raw result, so filters/sort never waste calls) and
  // cached by product id for the session; a failed or missing
  // prediction simply leaves that card without a badge — never a
  // synthesized score. The "% search match" badge stays separate:
  // it is a relevance signal, not a Deal Score.
  const [dealScores, setDealScores] = useState<Record<string, number>>({});
  const dealScoreAttemptedRef = useRef<Set<string>>(new Set());

  // Section 15, B10: the ai-search API's own did-you-mean (from its
  // fuzzy fallback / few-results correction) — the server's
  // correction is preferred over the page's client-side one below,
  // because the server knows whether the returned results are for
  // the corrected query. Reset at the start of every search so a
  // stale suggestion never flashes for the next query.
  const [serverDidYouMean, setServerDidYouMean] = useState<string | null>(null);

  // Spoken reply for a voice-started search: once the results land,
  // speak the count in the voice input's language, then clear the flag
  // so filter changes never re-speak.
  useEffect(() => {
    if (voiceSearchRef.current && hasSearched && !loading) {
      voiceSearchRef.current = false;
      speakSearchSummary(results.length, voiceLangRef.current);
    }
  }, [results, hasSearched, loading]);

  /**
   * Run a search against POST /api/v1/ai-search (Section 14, Chunk 4
   * — B1: the request carries page / pageSize / sort and the
   * server-side filters, and the response's meta carries the
   * effective page + filtered total — the page no longer slices or
   * sorts in memory). `req` overrides the current state: callers
   * that change a control in the same click (filter/sort/page)
   * pass the NEW value, because reading the state here would still
   * see the pre-click value. A fresh search always starts at page
   * 1 unless the caller passes an explicit page (?q= deep links
   * with ?page=, and the pager passes its target page).
   */
  const performSearch = useCallback(async (searchQuery: string, req: {
    mode?: 'text' | 'url';
    filters?: typeof filters;
    sort?: SearchSortKey;
    store?: string;
    band?: PriceBand;
    page?: number;
  } = {}) => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    setSearchError(false);
    setServerDidYouMean(null);
    setHasSearched(true);
    const effectiveMode = req.mode ?? searchMode;
    const activeFilters = req.filters ?? filters;
    const activeSort = req.sort ?? sort;
    const activeStore = req.store ?? storeFilter;
    const activeBand = req.band ?? priceBand;
    const activePage = req.page ?? 1;

    // Deep-linkable search (Section 10, chunk 1): a text search
    // writes ?q=… into the URL, so the search is shareable and
    // bookmarkable, and the ?q= effect below re-runs it on load.
    // lastSearchedRef stops that effect re-running the search we
    // just did when the URL update re-renders the page. The URL
    // carries the whole search state now (sort/store/category/
    // brand/max/minRating/band/page) — every active value is passed
    // explicitly, because urlStateRef may still hold the pre-click
    // value when a control changed in this same click.
    if (effectiveMode === 'text') {
      const trimmed = searchQuery.trim();
      lastSearchedRef.current = trimmed;
      setPage(activePage);
      writeSearchUrl({
        q: trimmed,
        sort: activeSort,
        store: activeStore,
        category: activeFilters.category,
        brand: activeFilters.brand,
        max: activeFilters.budgetMax,
        minRating: activeFilters.minRating,
        band: activeBand,
        page: activePage,
      });
    }

    try {
      // SEARCH_PAGE_SIZE is the server page size too (10): the API
      // slices the requested page, and meta.total is the filtered
      // count — the page renders meta, never a client slice.
      const body: Record<string, unknown> = { pageSize: SEARCH_PAGE_SIZE, page: activePage, sort: activeSort };

      if (effectiveMode === 'url') {
        body.url = searchQuery;
      } else {
        body.query = searchQuery;
      }

      // Server-side filters (category / brand / max budget / store /
      // min rating / price band) are applied by the ai-search API.
      // req.filters lets a filter change re-run the search with the
      // NEW values instead of the stale closure's (see
      // applyServerFilters below).
      const filterObj: Record<string, unknown> = {};
      if (activeFilters.category) filterObj.category = activeFilters.category;
      if (activeFilters.brand) filterObj.brand = activeFilters.brand;
      if (activeFilters.budgetMax) filterObj.budgetMax = parseFloat(activeFilters.budgetMax);
      if (activeFilters.minRating) filterObj.minRating = parseFloat(activeFilters.minRating);
      if (activeStore) filterObj.store = activeStore;
      if (activeBand !== 'all') filterObj.priceBand = activeBand;
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
        const nextResults = Array.isArray(data.data) ? data.data : (data.data?.results ?? []);
        setResults(nextResults);
        // B1: the server's effective page + filtered total — the
        // count line and the pager render these, never a client
        // slice. Fall back to the returned rows when meta is
        // missing (older cached response), never to a guessed total.
        setServerTotal(typeof data.meta?.total === 'number' ? data.meta.total : nextResults.length);
        const nextPage = typeof data.meta?.page === 'number' ? data.meta.page : activePage;
        setServerPage(nextPage);
        setPage(nextPage);
        // Web fallback results arrive separately in meta.webResults,
        // only when the catalog returned nothing. They are NOT catalog
        // products, so they are kept in their own state and rendered
        // as "Web result" cards with a retailer link below.
        setWebResults(Array.isArray(data.meta?.webResults) ? data.meta.webResults : []);
        setWebSource(data.meta?.source ?? null);
        setParsedIntent(data.meta?.parsedIntent ?? null);
        setCompareProducts(
          Array.isArray(data.meta?.compareProducts) ? data.meta.compareProducts : []
        );
        // Section 15, B10: the server's did-you-mean (fuzzy
        // fallback / few-results correction) — preferred over the
        // page's client-side suggestion below. Only a string
        // counts; anything else is treated as "no suggestion".
        setServerDidYouMean(
          typeof data.meta?.didYouMean === 'string' && data.meta.didYouMean.trim() !== ''
            ? data.meta.didYouMean
            : null
        );
        // B4: "On deal" badges for the returned products, from the
        // ranked-deals endpoint (one call per search, same rows the
        // deals page renders). Best-effort and non-blocking: a
        // failure leaves the badges off, never the results.
        if (nextResults.length > 0) {
          void (async () => {
            try {
              const dealsRes = await fetch('/api/v1/deals/ranked?limit=30', {
                signal: AbortSignal.timeout(15000),
              });
              if (!dealsRes.ok) return;
              const dealsData = await dealsRes.json();
              const list = Array.isArray(dealsData?.data?.deals) ? dealsData.data.deals : [];
              const byProduct: Record<string, { discountPercentage: number; savingsAmount: number }> = {};
              for (const d of list as Array<{ productId?: unknown; discountPercentage?: unknown; savingsAmount?: unknown }>) {
                if (typeof d.productId !== 'string') continue;
                byProduct[d.productId] = {
                  discountPercentage: typeof d.discountPercentage === 'number' ? d.discountPercentage : 0,
                  savingsAmount: typeof d.savingsAmount === 'number' ? d.savingsAmount : 0,
                };
              }
              setDealByProduct(byProduct);
            } catch {
              // No deal badges this search — cards render without them.
            }
          })();
        } else {
          setDealByProduct({});
        }
        // Web fallback results arrive separately in meta.webResults,
        // only when the catalog returned nothing. They are NOT catalog
        // products, so they are kept in their own state and rendered
        // as "Web result" cards with a retailer link below.
        setWebResults(Array.isArray(data.meta?.webResults) ? data.meta.webResults : []);
        setWebSource(data.meta?.source ?? null);
        setParsedIntent(data.meta?.parsedIntent ?? null);
        setCompareProducts(
          Array.isArray(data.meta?.compareProducts) ? data.meta.compareProducts : []
        );
        // Local-first retailer tabs: same query, split by the
        // visitor's country server-side. Text mode only — a URL
        // search has no product name to look up at local stores.
        // Its own try/catch: a failure here hides only this
        // section, never the results above.
        if (effectiveMode === 'text') {
          setLocalFirstLoading(true);
          setLocalFirstError(false);
          try {
            const lfRes = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
            const lfData = await lfRes.json();
            if (lfData.success && lfData.data) {
              setLocalFirst(lfData.data as LocalFirstSearchData);
            } else {
              setLocalFirstError(true);
              setLocalFirst(null);
            }
          } catch {
            setLocalFirstError(true);
            setLocalFirst(null);
          } finally {
            setLocalFirstLoading(false);
          }
        } else {
          setLocalFirst(null);
          setLocalFirstError(false);
          setLocalFirstLoading(false);
        }
      } else {
        setSearchError(true);
        setResults([]);
        setServerTotal(0);
        setServerPage(1);
        setDealByProduct({});
        setWebResults([]);
        setWebSource(null);
        setParsedIntent(null);
        setCompareProducts([]);
        setLocalFirst(null);
        setLocalFirstError(false);
        setLocalFirstLoading(false);
      }
    } catch {
      setSearchError(true);
      setResults([]);
      setServerTotal(0);
      setServerPage(1);
      setDealByProduct({});
      setWebResults([]);
      setWebSource(null);
      setParsedIntent(null);
      setCompareProducts([]);
      setLocalFirst(null);
      setLocalFirstError(false);
      setLocalFirstLoading(false);
    } finally {
      setLoading(false);
    }
  }, [filters, searchMode, liveWeb, router, writeSearchUrl, sort, storeFilter, priceBand]);

  // ?q= support (Section 10, chunk 1): /search?q=laptop runs the
  // search on load — deep-linkable, shareable, bookmarkable, and
  // the target the header search and the SearchAction JSON-LD
  // point at. Runs once per distinct ?q= value (guarded by
  // lastSearchedRef); filter/sort changes never re-trigger it.
  useEffect(() => {
    const q = searchParams.get('q')?.trim() ?? '';
    if (!q) return;
    if (lastSearchedRef.current === q) return;
    lastSearchedRef.current = q;
    setQuery(q);
    setSearchMode('text');
    // B1: a deep link replays its ?page= too (page state
    // initializes from the URL); a plain ?q= link runs page 1.
    void performSearch(q, { mode: 'text', page });
  }, [searchParams, performSearch, page]);

  // Section 14, Chunk 4 — B1: catalog sort / store / rating /
  // price-band are SERVER-side now (the ai-search API applies them
  // before slicing the page). The only client-side filtering left
  // is the WEB results list below — it is fetched alongside the
  // catalog (not server-paginated), so its store / rating / band
  // filters and its sort still run here, on the small list.
  const inPriceBand = (price: number, band: PriceBand): boolean => {
    if (band === 'under-100') return price < 100;
    if (band === '100-500') return price >= 100 && price <= 500;
    return price > 500;
  };

  // Section 13: category / brand dropdown options — exact product
  // text values from the catalog (the ai-search API matches them
  // with .eq(), so reference-table names that differ from the
  // product text would silently match nothing). One cheap
  // /api/v1/products call; values seen in the current results are
  // merged in as a fallback if that call fails.
  const [catalogFacets, setCatalogFacets] = useState<{ categories: string[]; brands: string[]; names: string[] }>({
    categories: [],
    brands: [],
    names: [],
  });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/v1/products?pageSize=100', {
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) return;
        const data = await res.json();
        const list = Array.isArray(data.data) ? data.data : (data.data?.products ?? []);
        const categories = new Set<string>();
        const brands = new Set<string>();
        // B5: product names too — the did-you-mean token set is
        // built from this same catalog fetch (names + brands +
        // categories), so no extra request is needed for it.
        const names = new Set<string>();
        for (const p of list as Array<{ category?: unknown; brand?: unknown; name?: unknown }>) {
          if (typeof p.category === 'string' && p.category.trim()) categories.add(p.category);
          if (typeof p.brand === 'string' && p.brand.trim()) brands.add(p.brand);
          if (typeof p.name === 'string' && p.name.trim()) names.add(p.name);
        }
        if (!cancelled) {
          setCatalogFacets({
            categories: [...categories].sort((a, b) => a.localeCompare(b)),
            brands: [...brands].sort((a, b) => a.localeCompare(b)),
            names: [...names].sort((a, b) => a.localeCompare(b)),
          });
        }
      } catch {
        // Dropdowns fall back to values seen in the results.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const categoryOptions = useMemo(() => {
    const set = new Set(catalogFacets.categories);
    for (const r of results) if (r.product.category) set.add(r.product.category);
    if (filters.category) set.add(filters.category);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [catalogFacets, results, filters.category]);

  const brandOptions = useMemo(() => {
    const set = new Set(catalogFacets.brands);
    for (const r of results) if (r.product.brand) set.add(r.product.brand);
    if (filters.brand) set.add(filters.brand);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [catalogFacets, results, filters.brand]);

  // Section 13: changing a server-side filter re-runs the current
  // search with the new values — the old panel only sent them on
  // the NEXT search, so a change after searching silently did
  // nothing until the visitor searched again.
  const applyServerFilters = (next: typeof filters) => {
    setFilters(next);
    setPage(1);
    writeSearchUrl({ category: next.category, brand: next.brand, max: next.budgetMax, minRating: next.minRating, page: 1 });
    if (hasSearched && query.trim()) void performSearch(query, { mode: 'text', filters: next, page: 1 });
  };

  // Section 14, Chunk 4 — B1: changing a server-side sort / store /
  // band re-runs the search from page 1 with the new value (the
  // old panel only re-sorted the fetched page in memory).
  const applyServerSort = (next: SearchSortKey) => {
    setSort(next);
    setPage(1);
    writeSearchUrl({ sort: next, page: 1 });
    if (hasSearched && query.trim()) void performSearch(query, { mode: 'text', sort: next, page: 1 });
  };
  const applyServerStore = (next: string) => {
    setStoreFilter(next);
    setPage(1);
    writeSearchUrl({ store: next, page: 1 });
    if (hasSearched && query.trim()) void performSearch(query, { mode: 'text', store: next, page: 1 });
  };
  const applyServerBand = (next: PriceBand) => {
    setPriceBand(next);
    setPage(1);
    writeSearchUrl({ band: next, page: 1 });
    if (hasSearched && query.trim()) void performSearch(query, { mode: 'text', band: next, page: 1 });
  };
  const applyServerMinRating = (next: string) => {
    const nextFilters = { ...filters, minRating: next };
    setFilters(nextFilters);
    setPage(1);
    writeSearchUrl({ minRating: next, page: 1 });
    if (hasSearched && query.trim()) void performSearch(query, { mode: 'text', filters: nextFilters, page: 1 });
  };

  const goToPage = (nextPage: number) => {
    setPage(nextPage);
    writeSearchUrl({ page: nextPage });
    if (hasSearched && query.trim()) void performSearch(query, { page: nextPage });
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    // Empty submit clears the deep link instead of leaving a
    // stale ?q= in the URL.
    if (!query.trim()) router.replace('/search');
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
      // B3: a band reads as a range ("Budget: $500–$1,000"). When
      // the visitor wrote a non-USD currency, the max end shows
      // what they wrote with the USD conversion marked approximate.
      if (parsedIntent.budgetMin !== null && parsedIntent.budgetMin !== undefined) {
        badges.push(`Budget: $${parsedIntent.budgetMin}–$${parsedIntent.budget}`);
      } else if (
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
    // B2: exclusions, shown as their own badges so a filtered
    // result set never looks like the catalog lacks the brand/term.
    if (parsedIntent.excludedBrands && parsedIntent.excludedBrands.length > 0) {
      badges.push(`Not: ${parsedIntent.excludedBrands.join(', ')}`);
    }
    if (parsedIntent.excludedTerms && parsedIntent.excludedTerms.length > 0) {
      badges.push(`Without: ${parsedIntent.excludedTerms.join(', ')}`);
    }
    // B7: attribute keywords matched in the query (per-product
    // matches are description-keyword matches — see the result
    // explanations).
    if (parsedIntent.attributes && Object.keys(parsedIntent.attributes).length > 0) {
      const labels = Object.keys(parsedIntent.attributes).map(
        (k) => ATTRIBUTE_BADGE_LABELS[k] ?? k
      );
      badges.push(`Attributes: ${labels.join(', ')}`);
    }
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

  // Web-only sort (Section 14, Chunk 4 — B1: the catalog sort is
  // server-side now, so this sorts only the web list, which is
  // small and fetched alongside the catalog, not server-paginated).
  // 'deal-score' cannot apply to web results (they have no
  // prediction), so they keep their fetched order for that key;
  // 'rating-desc' (B6) sorts by the rating SerpAPI reports, unrated
  // last. No discount sort: neither list carries an original /
  // compare-at price, so a discount cannot be computed honestly.
  const applySort = useCallback(
    <T extends { currentPrice?: number | null; price?: number | null; score?: number; rating?: number | null }>(
      items: T[]
    ): T[] => {
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
        case 'rating-desc':
          return sorted.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
        default:
          return sorted;
      }
    },
    [sort]
  );

  // B1: the catalog results ARE the server page — no client slice,
  // no client sort, no client filter. totalPages comes from the
  // server total (meta), and the effective page is the server's
  // (meta.page), so the pager can never point at a page the API
  // did not return.
  const displayedResults = results;
  const totalPages = Math.max(1, Math.ceil(serverTotal / SEARCH_PAGE_SIZE));
  const effectivePage = Math.min(serverPage, totalPages);
  const pagedResults = displayedResults;

  const displayedWebResults = useMemo(() => {
    let items = webResults;
    if (storeFilter) items = items.filter((w) => w.source === storeFilter);
    if (minRatingValue !== null) {
      items = items.filter((w) => w.rating !== null && w.rating >= minRatingValue);
    }
    if (priceBand !== 'all') {
      items = items.filter(
        (w) => w.price === null || w.price === undefined || inPriceBand(w.price, priceBand)
      );
    }
    return applySort(items);
  }, [webResults, storeFilter, minRatingValue, priceBand, applySort]);

  const clientFiltersActive =
    sort !== 'relevance' || storeFilter !== '' || filters.minRating !== '' || priceBand !== 'all';

  // B5: did-you-mean — Section 15, B10 extends it from zero
  // results to FEW results (catalog + web combined below
  // FEW_SEARCH_RESULTS): a 1–2 result set for a mistyped query is
  // a typo the visitor should be told about, not a success. The
  // server's suggestion (from the ai-search fuzzy fallback /
  // few-results correction) wins when present — it knows whether
  // the results are for the corrected query; the client-side
  // Levenshtein correction over the catalog tokens is the fallback
  // for older cached responses. Tokens come from the catalog fetch
  // above (names + brands + categories) — never from a guessed
  // list. The empty state below offers the suggestion as a link;
  // it never auto-redirects.
  const catalogTokens: SearchCatalogTokens = useMemo(
    () => ({
      names: catalogFacets.names,
      brands: catalogFacets.brands,
      categories: catalogFacets.categories,
    }),
    [catalogFacets]
  );
  const didYouMean = useMemo(() => {
    if (!hasSearched || loading || searchError) return null;
    if (results.length + webResults.length >= FEW_SEARCH_RESULTS) return null;
    return serverDidYouMean ?? suggestSearchCorrection(query, catalogTokens);
  }, [hasSearched, loading, searchError, results, webResults, query, catalogTokens, serverDidYouMean]);

  // ItemList JSON-LD for the displayed catalog results (S4#15):
  // real result URLs only (/products/<slug>). Web results are not
  // catalog pages, so they are never listed here.
  const itemListJsonLd = useMemo(
    () =>
      pagedResults.length > 0
        ? toJsonLd(
            buildItemListJsonLd(
              appConfig.url,
              pagedResults.map((r) => ({
                name: r.product.name,
                path: `/products/${r.product.slug}`,
              }))
            )
          )
        : null,
    [pagedResults]
  );

  // S2#10: fetch Deal Scores for whatever is currently displayed
  // (see the state above). Runs on the displayed set only, and each
  // product is attempted at most once per page session.
  useEffect(() => {
    const pending = displayedResults.filter(
      (r) => !dealScoreAttemptedRef.current.has(r.product.id)
    );
    if (pending.length === 0) return;
    for (const r of pending) dealScoreAttemptedRef.current.add(r.product.id);
    void Promise.all(
      pending.map(async (r) => {
        try {
          const predRes = await fetch(`/api/v1/predictions/${r.product.id}`, {
            signal: AbortSignal.timeout(15000),
          });
          if (!predRes.ok) return;
          const predData = await predRes.json();
          if (!predData.success || !predData.data) return;
          // Section 15, B1: dealScoreForDisplay hides the badge
          // while the prediction rests on fewer than
          // DEAL_SCORE_MIN_DATA_POINTS (5) price points — the live
          // catalog's 4 points per product all score a meaningless
          // 100/100. The formula itself is unchanged.
          const score = dealScoreForDisplay(predData.data);
          if (score === null) return;
          setDealScores((prev) => ({ ...prev, [r.product.id]: score }));
        } catch {
          // No prediction for this card — no badge, no error.
        }
      })
    );
  }, [displayedResults]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <SiteHeader />
      <div className="container mx-auto max-w-6xl px-4 py-8">
        <div className="mb-8 text-center">
          <h1 className="bg-gradient-to-r from-blue-600 to-cyan-600 dark:from-blue-400 dark:to-cyan-400 bg-clip-text text-3xl font-bold text-transparent sm:text-4xl">
            {tFor(language, 'pageHeadingSearch')}
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
                'flex min-h-[44px] items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-all',
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
                'flex min-h-[44px] items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-all',
                searchMode === 'url'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400'
              )}
            >
              <Link2 className="h-4 w-4" /> URL Search
            </button>
          </div>

          {/* flex-wrap: on narrow phones the input + Search +
              Filters buttons used to squeeze onto one row; they
              now wrap instead of overflowing or crushing the input. */}
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[200px] flex-1">
              {searchMode === 'text' ? (
                <SearchAutocomplete
                  value={query}
                  onChange={setQuery}
                  onSubmit={(q) => performSearch(q, { mode: 'text' })}
                  onSelectSuggestion={(suggestion) =>
                    router.push(`/products/${suggestion.slug}`)
                  }
                  placeholder={tFor(language, 'searchPlaceholder')}
                  inputId="search-page-input"
                  ariaLabel="Search for products"
                  autoFocus
                />
              ) : (
                <>
                  <Link2 className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="url"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Paste a product URL (e.g. https://...)"
                    aria-label="Paste a product URL to search"
                    className="pl-10"
                    autoFocus
                  />
                </>
              )}
            </div>
            <Button type="submit" disabled={loading || !query.trim()} className="min-h-[44px]">
              {loading ? <LoadingSpinner size="sm" /> : 'Search'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowFilters(!showFilters)}
              className="min-h-[44px]"
            >
              <SlidersHorizontal className="mr-2 h-4 w-4" />
              Filters
            </Button>
          </div>
        </form>

        {/* Option 7: browser-native voice input (Web Speech API). The
            transcript is shown as text and runs through the SAME search
            path as typed input — no parallel search, no server audio. */}
        <div className="mb-6">
          <VoiceSearchButton
            disabled={loading}
            onTranscript={(text, langCode) => {
              setQuery(text);
              setSearchMode('text');
              voiceLangRef.current = langCode;
              voiceSearchRef.current = true;
              performSearch(text, { mode: 'text' });
            }}
          />
        </div>

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
                  performSearch(recent, { mode: 'text' });
                }}
                className="flex min-h-[44px] items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-sm transition-all hover:border-blue-300 hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-blue-700 dark:hover:bg-slate-700"
              >
                {recent}
              </button>
            ))}
            <button
              type="button"
              onClick={clearRecentSearches}
              className="flex min-h-[44px] items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          </div>
        )}

        {/* Section 15, C2 — saved searches (named, re-runnable,
            dashboard-listed). The save form gets the live URL query
            string — everything /search URL-syncs — so saving is just
            persisting that string + a name. Guests see the sign-in
            hint; a failed fetch hides the card. */}
        <div className="mb-6">
          <SavedSearches currentQueryString={searchParams.toString()} />
        </div>

        {showFilters && (
          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold leading-none tracking-tight">Search Filters</h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFilters({ category: '', brand: '', budgetMax: '', minRating: '' });
                    setSort('relevance');
                    setStoreFilter('');
                    setPriceBand('all');
                    setPage(1);
                    setLiveWeb(false);
                    writeSearchUrl({ sort: 'relevance', store: '', category: '', brand: '', max: '', minRating: '', band: 'all', page: 1 });
                    // B1: clearing re-runs the search with cleared
                    // filters (server-side now), so the results
                    // actually un-filter instead of staying stale.
                    if (hasSearched && query.trim()) {
                      void performSearch(query, {
                        mode: 'text',
                        filters: { category: '', brand: '', budgetMax: '', minRating: '' },
                        sort: 'relevance',
                        store: '',
                        band: 'all',
                        page: 1,
                      });
                    }
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
                    onValueChange={(v) => applyServerSort(v as SearchSortKey)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Relevance" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="relevance">Relevance</SelectItem>
                      <SelectItem value="price-asc">Price: Low to High</SelectItem>
                      <SelectItem value="price-desc">Price: High to Low</SelectItem>
                      <SelectItem value="match-desc">Best Match</SelectItem>
                      <SelectItem value="deal-score">Deal Score: High to Low</SelectItem>
                      <SelectItem value="rating-desc">Top Rated</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-sm">Store</Label>
                  <Select
                    value={storeFilter || 'all'}
                    onValueChange={(v) => applyServerStore(v === 'all' ? '' : v)}
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
                  <Select
                    value={filters.category || 'all'}
                    onValueChange={(v) => applyServerFilters({ ...filters, category: v === 'all' ? '' : v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All categories" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All categories</SelectItem>
                      {categoryOptions.map((category) => (
                        <SelectItem key={category} value={category}>
                          {category}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-sm">Brand</Label>
                  <Select
                    value={filters.brand || 'all'}
                    onValueChange={(v) => applyServerFilters({ ...filters, brand: v === 'all' ? '' : v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All brands" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All brands</SelectItem>
                      {brandOptions.map((brand) => (
                        <SelectItem key={brand} value={brand}>
                          {brand}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-sm">Max Budget ($)</Label>
                  <Input
                    type="number"
                    value={filters.budgetMax}
                    onChange={(e) => {
                      const next = { ...filters, budgetMax: e.target.value };
                      setFilters(next);
                      writeSearchUrl({ max: next.budgetMax });
                    }}
                    onBlur={() => {
                      if (hasSearched && query.trim()) void performSearch(query, { mode: 'text', filters, page: 1 });
                    }}
                    placeholder="e.g. 1000"
                  />
                </div>
                <div>
                  <Label className="mb-1.5 block text-sm">Price band</Label>
                  <Select
                    value={priceBand}
                    onValueChange={(v) => applyServerBand(v as PriceBand)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Any price" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any price</SelectItem>
                      <SelectItem value="under-100">Under $100</SelectItem>
                      <SelectItem value="100-500">$100 – $500</SelectItem>
                      <SelectItem value="500-plus">Over $500</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-sm">Min Rating</Label>
                  <Select
                    value={filters.minRating || 'any'}
                    onValueChange={(v) => applyServerMinRating(v === 'any' ? '' : v)}
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
                    bachta hai. (Needs a SerpAPI key in your hosting dashboard; warna sirf catalog dikhega.)
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
                  className="flex min-h-[44px] items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm transition-all hover:border-blue-300 hover:bg-blue-50 hover:shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:hover:border-blue-700 dark:hover:bg-slate-700"
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

        {/* B10: "X vs Y" compare routing — the two resolved products
            with a CTA to the compare page. Rendered only when both
            sides resolved; a failed resolution shows no CTA and the
            normal first-side results below. */}
        {compareProducts.length === 2 && (
          <div className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950">
            <span className="text-sm font-medium">Compare these two:</span>
            <span className="text-sm">
              {compareProducts[0].name} vs {compareProducts[1].name}
            </span>
            <Button
              size="sm"
              onClick={() =>
                router.push(`/compare?products=${compareProducts[0].id},${compareProducts[1].id}`)
              }
            >
              Compare these two →
            </Button>
          </div>
        )}

        {/* B5: did-you-mean — one suggested correction, offered as
            a link the visitor taps to run it. Never an
            auto-redirect. Section 15, B10: this row lives OUTSIDE
            the empty-state block, so it shows for zero AND few
            results (catalog + web below FEW_SEARCH_RESULTS) — when
            the fuzzy fallback already ran, the results below ARE
            the corrected query's, and the row says so by offering
            the spelling they came from. A filtered-out result set
            is still a filter problem, not a typo: the suggestion
            only appears when a real correction exists. */}
        {didYouMean && results.length + webResults.length < FEW_SEARCH_RESULTS && (
          <div className="mb-6 flex justify-center">
            <button
              type="button"
              onClick={() => {
                setQuery(didYouMean);
                void performSearch(didYouMean, { mode: 'text', page: 1 });
              }}
              className="flex min-h-[44px] items-center rounded-full border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition-all hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-300"
            >
              Did you mean: {didYouMean}?
            </button>
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

        {!loading && hasSearched && searchError && displayedResults.length === 0 && displayedWebResults.length === 0 && (
          <>
            <EmptyState
              title="Search failed"
              description="We couldn't reach the search service — this doesn't mean the catalog has nothing for your query. Check your connection and try again."
              icon={Search}
            />
            <div className="mt-4 flex justify-center">
              <Button variant="outline" onClick={() => performSearch(query)}>
                Try again
              </Button>
            </div>
          </>
        )}

        {!loading && !searchError && hasSearched && displayedResults.length === 0 && displayedWebResults.length === 0 && (
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
                    ? 'We searched our catalog and found nothing for this query. Live web search is not configured yet (it needs a SerpAPI key in your hosting dashboard), so no web fallback ran. Try a broader product name, check the spelling, or clear your filters.'
                    : 'We searched our catalog and, when it had nothing, live web shopping results too — and found nothing for this query. Try a broader product name, check the spelling, remove a budget limit, or clear your filters.'
                }
                icon={Search}
              />
            )}
            {/* B5 did-you-mean row moved above (Section 15, B10):
                it now renders for zero AND few results, outside
                this empty-state block. */}
            {(clientFiltersActive || filters.category || filters.brand || filters.budgetMax) && (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="outline"
                  onClick={() => {
                    setFilters({ category: '', brand: '', budgetMax: '', minRating: '' });
                    setSort('relevance');
                    setStoreFilter('');
                    setPriceBand('all');
                    setPage(1);
                    setLiveWeb(false);
                    writeSearchUrl({ sort: 'relevance', store: '', category: '', brand: '', max: '', minRating: '', band: 'all', page: 1 });
                    // B1: clearing re-runs the search with cleared
                    // filters (server-side now), so the results
                    // actually un-filter instead of staying stale.
                    if (hasSearched && query.trim()) {
                      void performSearch(query, {
                        mode: 'text',
                        filters: { category: '', brand: '', budgetMax: '', minRating: '' },
                        sort: 'relevance',
                        store: '',
                        band: 'all',
                        page: 1,
                      });
                    }
                  }}
                >
                  Clear all filters
                </Button>
              </div>
            )}
            {/* Section 11, Chunk C: "save this search" for a query
                with zero matches anywhere. Device-only — it re-saves
                the query into Recent searches (saveRecentSearch
                dedupes, so a text search already saved by
                performSearch is just confirmed, not duplicated).
                Honest limit in the copy: nothing checks for new
                matches in the background and no email is ever sent —
                the visitor re-runs the saved search to see if
                anything new appeared. */}
            {results.length === 0 && webResults.length === 0 && (
              <div className="mt-4 flex flex-col items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    saveRecentSearch(query);
                    setSavedSearch(query.trim());
                  }}
                  disabled={savedSearch !== null && savedSearch === query.trim()}
                >
                  <Bell className="mr-2 h-4 w-4" />
                  {savedSearch !== null && savedSearch === query.trim()
                    ? 'Search saved'
                    : 'Save this search'}
                </Button>
                <p className="max-w-sm text-center text-xs text-muted-foreground">
                  {savedSearch !== null && savedSearch === query.trim()
                    ? 'Saved on this device — find it under Recent searches below the search box. We don\u2019t check for new matches in the background, so re-run it anytime to see if anything new appeared.'
                    : 'Save this search on this device so you can re-run it later from Recent searches. No background checks, no emails.'}
                </p>
              </div>
            )}
          </>
        )}

        {!loading && displayedResults.length > 0 && (
          <div className="grid gap-4">
            {/* h2 for the h3 product names below; JSON-LD for the
                same real result URLs (S4#15). */}
            <h2 className="sr-only">Search results</h2>
            {itemListJsonLd && (
              <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: itemListJsonLd }}
              />
            )}
            <div className="text-sm text-muted-foreground">
              {/* B1: the count is the server total (meta) — the
                  filtered count the pager pages through, never a
                  client-slice length. */}
              {serverTotal === 0
                ? '0 results'
                : `Showing ${(effectivePage - 1) * SEARCH_PAGE_SIZE + 1}–${(effectivePage - 1) * SEARCH_PAGE_SIZE + pagedResults.length} of ${serverTotal} result${serverTotal !== 1 ? 's' : ''}`}
              {/* Section 13, item 55 — the search URL is already
                  shareable (?q=); the button was missing. */}
              <span className="mt-2 block">
                <ShareButtons title={`SmartBuy AI search results for "${query}"`} />
              </span>
              {/* Budget honesty for unpriced rows: the server hard
                  filter keeps products with no recorded price (their
                  price is unknown, not over budget), but they must
                  never read as "in budget" — they carry no "In
                  budget" badge and show "Price not listed". The
                  price-band facet follows the same rule: unpriced
                  rows pass it because their price is unknown. */}
              {(parsedIntent?.budget != null || filters.budgetMax !== '' || priceBand !== 'all') &&
                displayedResults.some((r) => r.currentPrice === null || r.currentPrice === undefined) && (
                  <span className="block mt-1">
                    Products without a recorded price are shown because their price is unknown,
                    not because they are within your budget.
                  </span>
                )}
            </div>
            {pagedResults.map((result) => (
              <Card
                key={result.product.id}
                role="button"
                tabIndex={0}
                aria-label={`View ${result.product.name}`}
                className="cursor-pointer transition-all hover:shadow-lg hover:border-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:hover:border-blue-800"
                onClick={() => handleProductClick(result.product.slug)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleProductClick(result.product.slug);
                  }
                }}
              >
                <CardContent className="flex flex-col gap-4 p-4 sm:flex-row">
                  <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                    {result.product.imageUrl && !failedImages.has(result.product.id) ? (
                      // Lazy + sized <img> (Section 10, chunk 1):
                      // next/image is NOT usable here — its
                      // remotePatterns allowlist (next.config.js)
                      // covers only unsplash/pexels, while product
                      // photos come from merchant hosts, so Image
                      // would throw at runtime. loading="lazy" +
                      // explicit dimensions give the same
                      // below-fold saving without the allowlist.
                      <img
                        src={result.product.imageUrl}
                        alt={result.product.name}
                        width={96}
                        height={96}
                        loading="lazy"
                        decoding="async"
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
                          <Price usd={result.currentPrice} className="text-lg font-bold text-blue-600" showFxNote />
                        ) : (
                          <span className="text-xs text-muted-foreground">Price not listed</span>
                        )}
                        {/* S2#10: canonical Deal Score (lib/deal-score.ts),
                            from the product's price-drop prediction.
                            Renders only when a real prediction exists;
                            the "% search match" badge below it is a
                            relevance signal, not a Deal Score. */}
                        {dealScores[result.product.id] !== undefined && (
                          <DealScoreBadge score={dealScores[result.product.id]} size="sm" showLabel />
                        )}
                        {/* S3#4: real price-history sparkline; renders
                            nothing when the product has fewer than 2
                            recorded points. */}
                        <PriceTrendSparkline slug={result.product.slug} showChange />
                        {/* A2 label fix: this is the SEARCH relevance
                            score (services/ai-search.ts: product
                            confidenceScore + 15 per matched attribute,
                            capped at 100) — NOT the product page's
                            Deal Score, which is a different formula
                            (price history + discount probability).
                            The old bare "% match" badge sat next to
                            a price and was read as a deal score, so
                            a 65% search match looked like it
                            contradicted the product page's Deal
                            Score 100. Labeling it "search match"
                            keeps the two numbers unconfusable; the
                            search API returns no Deal Score, so none
                            is shown here rather than computed ad hoc. */}
                        <Badge
                          className="bg-blue-600"
                          title="Search match: how closely this result matches your search query — not a Deal Score. Deal Scores are shown on product pages."
                        >
                          {Math.round(result.score)}% search match
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
                    {/* B1: which query words this product's text
                        carries (tokenized match, not a spec claim). */}
                    {result.matchedTerms && result.matchedTerms.length > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Matched: {result.matchedTerms.join(' · ')}
                      </p>
                    )}
                    {/* B4: active deal on this product (ranked-deals
                        endpoint, the same rows the deals page
                        renders). No deal, no badge — never a guessed
                        discount; a % deal, a $ deal, or both. */}
                    {(() => {
                      const deal = dealByProduct[result.product.id];
                      if (!deal || (deal.discountPercentage <= 0 && deal.savingsAmount <= 0)) return null;
                      return (
                        <p className="mt-1 text-xs font-medium text-green-600">
                          On deal
                          {deal.discountPercentage > 0 && `: ${deal.discountPercentage}% off`}
                          {deal.savingsAmount > 0 && (
                            <>
                              {' '}— save <Price usd={deal.savingsAmount} showOriginal={false} />
                            </>
                          )}
                        </p>
                      );
                    })()}
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
                        productSlug={result.product.slug}
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
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={effectivePage <= 1}
                  onClick={() => goToPage(effectivePage - 1)}
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {effectivePage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={effectivePage >= totalPages}
                  onClick={() => goToPage(effectivePage + 1)}
                >
                  Next
                </Button>
              </div>
            )}
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
                        // Same lazy + sized <img> as the catalog
                        // cards above (next/image allowlist does not
                        // cover retailer thumbnail hosts).
                        <img
                          src={web.thumbnail}
                          alt={web.title}
                          width={96}
                          height={96}
                          loading="lazy"
                          decoding="async"
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
                          <Price usd={web.price} className="text-lg font-bold text-blue-600" showFxNote />
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

        {/* Local-first retailer search — additive tabbed section
            (local vs global stores for the visitor's country),
            fetched from /api/search after the main search. It
            never changes the ai-search results, filters, or sort
            above. */}
        {hasSearched && (
          <ProductSearchResults
            key={`${localFirst?.query ?? ''}-${localFirst?.country ?? ''}`}
            data={localFirst}
            loading={localFirstLoading}
            error={localFirstError}
          />
        )}
      </div>
      <SiteFooter />
    </div>
  );
}

// useSearchParams() requires a Suspense boundary in the App
// Router (Next 13.5): the ?q= reader above is wrapped so the page
// still builds and streams instead of failing the build.
export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      }
    >
      <SearchPageContent />
    </Suspense>
  );
}
