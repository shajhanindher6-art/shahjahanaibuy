// @vitest-environment jsdom
/**
 * PostHog 5-event analytics — search page event tests.
 *
 * Renders `app/search/page.tsx` for real in jsdom. The search is
 * driven by the page's own `?q=` deep-link effect (no input
 * interaction needed): the mocked `useSearchParams` supplies the
 * query, the mocked `fetch` supplies the ai-search response, and
 * the tracker is mocked so the test asserts the CALL SITE, not the
 * tracker itself (the tracker has its own unit tests). The heavy
 * children (header, footer, autocomplete, result cards) are stubbed
 * to null — the page's own search logic, results state and pager
 * are what is under test.
 *
 * The page's contract, as coded:
 * - a successful search fires product_searched exactly once, with
 *   results_count (the API's filtered total) and, when a category
 *   is available, search_type — never the raw query;
 * - a failed search fires NOTHING;
 * - paging to the next page (same query, re-run) does NOT re-fire
 *   (the lastTrackedSearchRef dedupe);
 * - a genuinely new query fires again.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';

const fakeRouter = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

const fakeSearchParams = vi.hoisted(() => ({
  value: 'q=laptop',
}));

const fakeTrack = vi.hoisted(() => ({
  trackEvent: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => fakeRouter,
  usePathname: () => '/search',
  useSearchParams: () => new URLSearchParams(fakeSearchParams.value),
}));

vi.mock('lucide-react', () => {
  const stub = () => null;
  return {
    Search: stub,
    SlidersHorizontal: stub,
    X: stub,
    Star: stub,
    TrendingDown: stub,
    Link2: stub,
    History: stub,
    Bell: stub,
    PackageOpen: stub,
    Loader2: stub,
    Check: stub,
    ChevronDown: stub,
    ChevronUp: stub,
  };
});

vi.mock('@/components/layout/site-header', () => ({ SiteHeader: () => null }));
vi.mock('@/components/layout/site-footer', () => ({ SiteFooter: () => null }));
vi.mock('@/components/search/search-autocomplete', () => ({
  SearchAutocomplete: () => null,
}));
vi.mock('@/components/search/saved-searches', () => ({
  SavedSearches: () => null,
}));
vi.mock('@/components/search/product-search-results', () => ({
  ProductSearchResults: () => null,
}));
vi.mock('@/components/search/voice-search-button', () => ({
  VoiceSearchButton: () => null,
  speakSearchSummary: () => {},
}));
vi.mock('@/components/products/wishlist-button', () => ({
  WishlistButton: () => null,
}));
vi.mock('@/components/products/share-buttons', () => ({
  ShareButtons: () => null,
}));
vi.mock('@/components/products/price-alert-dialog', () => ({
  PriceAlertDialog: () => null,
}));
vi.mock('@/components/region/price', () => ({ Price: () => null }));
vi.mock('@/components/products/deal-score-badge', () => ({
  DealScoreBadge: () => null,
}));
vi.mock('@/components/products/stale-price-badge', () => ({
  StalePriceBadge: () => null,
}));
vi.mock('@/components/products/price-trend-sparkline', () => ({
  PriceTrendSparkline: () => null,
}));
vi.mock('@/components/region/region-provider', () => ({
  useRegion: () => ({ language: 'en' }),
}));

vi.mock('@/components/analytics/track-event', () => ({
  trackEvent: (...args: unknown[]) => fakeTrack.trackEvent(...args),
}));

// Imported after the mocks so the page uses the fakes.
import SearchPage from '@/app/search/page';

const fetchMock = vi.fn();

function jsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

function aiSearchSuccess() {
  return {
    success: true,
    data: [
      {
        product: {
          id: 'prod-1',
          name: 'MacBook Air 13',
          slug: 'macbook-air-13',
          description: 'A laptop',
          brand: 'Apple',
          category: 'Laptops',
          imageUrl: null,
          dataFreshness: null,
        },
        score: 0.9,
        matchedAttributes: [],
        aiExplanation: 'Matches.',
        currentPrice: 999,
        stores: ['Amazon'],
        rating: 4.5,
        ratingCount: 10,
      },
      {
        product: {
          id: 'prod-2',
          name: 'Dell XPS 13',
          slug: 'dell-xps-13',
          description: 'A laptop',
          brand: 'Dell',
          category: 'Laptops',
          imageUrl: null,
          dataFreshness: null,
        },
        score: 0.8,
        matchedAttributes: [],
        aiExplanation: 'Matches.',
        currentPrice: 1099,
        stores: ['Amazon'],
        rating: 4.4,
        ratingCount: 8,
      },
    ],
    meta: { total: 25, page: 1, source: 'catalog' },
  };
}

describe('SearchPage — product_searched event', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    fakeSearchParams.value = 'q=laptop';
    // Default fetch: a successful ai-search; every other endpoint
    // gets a safe failure shape (the page handles those gracefully).
    // The ai-search mock echoes the requested page in meta.page —
    // the pager test needs a real page 2, not a constant page 1.
    fetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (
        typeof url === 'string' &&
        url.includes('/api/v1/ai-search') &&
        opts?.method === 'POST'
      ) {
        const body = JSON.parse(String(opts.body ?? '{}')) as {
          page?: number;
        };
        const page = typeof body.page === 'number' ? body.page : 1;
        const res = aiSearchSuccess();
        return jsonResponse({
          ...res,
          meta: { ...res.meta, page },
        });
      }
      return jsonResponse({ success: false });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('fires product_searched exactly once on a successful search, with results_count and no raw query', async () => {
    render(createElement(SearchPage));
    await waitFor(
      () => expect(fakeTrack.trackEvent).toHaveBeenCalledTimes(1),
      { timeout: 5000 }
    );
    expect(fakeTrack.trackEvent).toHaveBeenCalledWith('product_searched', {
      results_count: 25,
    });
    // No raw query, no search text, no user data in the event.
    const props = fakeTrack.trackEvent.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(Object.keys(props)).toEqual(['results_count']);
    expect(JSON.stringify(props)).not.toContain('laptop');
  });

  it('includes search_type when a category filter is active', async () => {
    fakeSearchParams.value = 'q=laptop&category=Laptops';
    render(createElement(SearchPage));
    await waitFor(
      () => expect(fakeTrack.trackEvent).toHaveBeenCalledTimes(1),
      { timeout: 5000 }
    );
    expect(fakeTrack.trackEvent).toHaveBeenCalledWith('product_searched', {
      results_count: 25,
      search_type: 'Laptops',
    });
  });

  it('does NOT fire when the search fails', async () => {
    fetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (
        typeof url === 'string' &&
        url.includes('/api/v1/ai-search') &&
        opts?.method === 'POST'
      ) {
        return jsonResponse({ success: false });
      }
      return jsonResponse({ success: false });
    });
    render(createElement(SearchPage));
    await waitFor(
      () => expect(screen.getByText('Search failed')).toBeTruthy(),
      { timeout: 5000 }
    );
    expect(fakeTrack.trackEvent).not.toHaveBeenCalled();
  });

  it('does NOT re-fire when paging to the next page of the same search', async () => {
    render(createElement(SearchPage));
    await waitFor(
      () => expect(fakeTrack.trackEvent).toHaveBeenCalledTimes(1),
      { timeout: 5000 }
    );
    // total 25 / page size 10 → 3 pages, so the pager renders.
    expect(screen.getByText('Page 1 of 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    await waitFor(
      () => expect(screen.getByText('Page 2 of 3')).toBeTruthy(),
      { timeout: 5000 }
    );
    // The page-2 re-run is the same search — no second event.
    expect(fakeTrack.trackEvent).toHaveBeenCalledTimes(1);
  });

  it('fires again for a genuinely new query', async () => {
    const { rerender } = render(createElement(SearchPage));
    await waitFor(
      () => expect(fakeTrack.trackEvent).toHaveBeenCalledTimes(1),
      { timeout: 5000 }
    );
    fakeSearchParams.value = 'q=phone';
    rerender(createElement(SearchPage));
    await waitFor(
      () => expect(fakeTrack.trackEvent).toHaveBeenCalledTimes(2),
      { timeout: 5000 }
    );
    expect(fakeTrack.trackEvent).toHaveBeenNthCalledWith(
      2,
      'product_searched',
      { results_count: 25 }
    );
  });
});
