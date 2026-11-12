'use client';
import Image from 'next/image';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Tag, Zap, Clock, TrendingDown, Sparkles, ChevronRight, Copy, Check, CalendarDays, Bell, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import { appConfig } from '@/lib/config/app';
import { buildItemListJsonLd, toJsonLd } from '@/lib/json-ld';
import { Price } from '@/components/region/price';
import { StalePriceBadge } from '@/components/products/stale-price-badge';
import { useRegion } from '@/components/region/region-provider';
import { tFor } from '@/lib/i18n';
import { CommunityDeals } from '@/components/deals/community-deals';
import { DealHotspotsCalendar } from '@/components/deals/deal-hotspots-calendar';
import { NewsletterCapture } from '@/components/home/newsletter-capture';
import { AutoCouponHub } from '@/components/deals/auto-coupon-hub';
import { ShareButtons } from '@/components/products/share-buttons';
import { CuratedDealOfTheDay } from '@/components/curators/curated-deal-of-the-day';
import { CurationGuidelines } from '@/components/curators/curation-guidelines';
import { SEASONAL_EVENTS } from '@/components/seasonal/events';
import {
  filterDealsByMinDiscount,
  paginateList,
  sortCoupons,
} from '@/lib/deal-list';
import { DEAL_VERIFIED_MEANING } from '@/lib/fact-check';

interface RankedDeal {
  id: string;
  dealId: string | null;
  productId: string | null;
  dealType: string;
  aiScore: number;
  discountPercentage: number;
  savingsAmount: number;
  currentPrice: number | null;
  isFeatured: boolean;
  rankedAt: string;
  deal: {
    id: string;
    title: string;
    description: string | null;
    dealType: string;
    discountType: string;
    discountValue: number;
    startAt: string;
    endAt: string;
    couponCode: string | null;
    url: string | null;
    active: boolean;
  } | null;
  product: {
    id: string;
    name: string;
    slug: string;
    brand: string | null;
    category: string | null;
    imageUrl: string | null;
    /** Recorded `products.data_freshness` (Section 16, item 9) —
        the ranked-deals API returns the full product row; older
        cached responses may omit it, so the badge renders nothing. */
    dataFreshness?: string | null;
  } | null;
}

const DEAL_CATEGORIES = [
  { key: '', label: 'All Deals', icon: Tag },
  { key: 'flash', label: 'Flash Deals', icon: Zap },
  { key: 'coupon', label: 'Coupons', icon: Tag },
  { key: 'hidden', label: 'Hidden Discounts', icon: Sparkles },
  { key: 'student', label: 'Student Discounts', icon: Tag },
  { key: 'holiday', label: 'Holiday Sales', icon: Clock },
];

// Section 13, Chunk A — deals sort / filter / pagination helpers
// (pure, local to this page).
const DEALS_PAGE_SIZE = 12;

type DealSortKey = 'ai' | 'discount' | 'savings' | 'ending';
type DealPriceBand = 'all' | 'under-100' | '100-500' | '500-plus';

function inDealPriceBand(price: number, band: DealPriceBand): boolean {
  if (band === 'under-100') return price < 100;
  if (band === '100-500') return price >= 100 && price <= 500;
  return price > 500;
}

/**
 * Merchant for a ranked deal, from the deal's own outbound URL
 * hostname — the ranked-deals response carries no merchant field.
 * Null when the deal has no URL: no merchant is ever guessed.
 */
function dealMerchantHost(deal: RankedDeal): string | null {
  const url = deal.deal?.url;
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

const KNOWN_DEAL_MERCHANTS: Record<string, string> = {
  'amazon.com': 'Amazon',
  'bestbuy.com': 'Best Buy',
};

function dealMerchantLabel(host: string): string {
  return KNOWN_DEAL_MERCHANTS[host] ?? host;
}

interface Coupon {
  id: string;
  code: string;
  merchantId: string | null;
  description: string | null;
  discountType: string;
  discountValue: number;
  minOrderValue: number | null;
  maxDiscountAmount: number | null;
  validUntil: string | null;
}

export default function DealsPage() {
  const router = useRouter();
  const { region, language } = useRegion();
  const [deals, setDeals] = useState<RankedDeal[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [merchantNames, setMerchantNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('');
  const [featuredOnly, setFeaturedOnly] = useState(false);
  // Section 13: sort / filters / pagination, all reflected in the
  // URL (?type=&featured=&sort=&merchant=&brand=&band=&page=) so a
  // filtered deals view is shareable. Initial values come from the
  // URL on mount (window.location — this page has no Suspense
  // boundary, same pattern as /compare's deep link).
  const [dealSort, setDealSort] = useState<DealSortKey>('ai');
  const [merchantFilter, setMerchantFilter] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [dealPriceBand, setDealPriceBand] = useState<DealPriceBand>('all');
  // B14: minimum discount filter ("at least 20% off"), from the
  // discountPercentage already on every ranked deal. '' = no minimum.
  const [minDiscount, setMinDiscount] = useState('');
  const [dealsPage, setDealsPage] = useState(1);
  const dealsUrlRef = useRef({
    type: '',
    featured: false,
    sort: 'ai' as DealSortKey,
    merchant: '',
    brand: '',
    band: 'all' as DealPriceBand,
    minDiscount: '',
    page: 1,
  });
  dealsUrlRef.current = {
    type: activeCategory,
    featured: featuredOnly,
    sort: dealSort,
    merchant: merchantFilter,
    brand: brandFilter,
    band: dealPriceBand,
    minDiscount,
    page: dealsPage,
  };

  const writeDealsUrl = useCallback(
    (patch: Partial<{
      type: string;
      featured: boolean;
      sort: DealSortKey;
      merchant: string;
      brand: string;
      band: DealPriceBand;
      minDiscount: string;
      page: number;
    }>) => {
      const s = { ...dealsUrlRef.current, ...patch };
      const params = new URLSearchParams();
      if (s.type) params.set('type', s.type);
      if (s.featured) params.set('featured', 'true');
      if (s.sort !== 'ai') params.set('sort', s.sort);
      if (s.merchant) params.set('merchant', s.merchant);
      if (s.brand) params.set('brand', s.brand);
      if (s.band !== 'all') params.set('band', s.band);
      if (s.minDiscount) params.set('minDiscount', s.minDiscount);
      if (s.page > 1) params.set('page', String(s.page));
      const qs = params.toString();
      router.replace(qs ? `/deals?${qs}` : '/deals');
    },
    [router]
  );

  const fetchDeals = useCallback(async () => {
    setLoading(true);
    try {
      // The Coupons tab previously queried /deals/ranked with
      // dealType=coupon — but coupons live in their own `coupons`
      // table (e.g. SAVE10, BESTBUY15), not as deals, so the tab
      // always showed 0. It now reads the coupons endpoint, with
      // merchant names resolved from /merchants for display.
      if (activeCategory === 'coupon') {
        const [couponsRes, merchantsRes] = await Promise.all([
          fetch('/api/v1/coupons?pageSize=30'),
          fetch('/api/v1/merchants?pageSize=100'),
        ]);
        const couponsData = await couponsRes.json();
        setCoupons(couponsData.success && Array.isArray(couponsData.data) ? couponsData.data : []);
        const merchantsData = await merchantsRes.json();
        if (merchantsData.success && Array.isArray(merchantsData.data)) {
          const names: Record<string, string> = {};
          for (const m of merchantsData.data as Array<{ id: string; name: string }>) names[m.id] = m.name;
          setMerchantNames(names);
        }
        setDeals([]);
      } else {
        const params = new URLSearchParams({ limit: '30' });
        if (activeCategory) params.set('dealType', activeCategory);
        if (featuredOnly) params.set('featured', 'true');

        const res = await fetch(`/api/v1/deals/ranked?${params}`);
        const data = await res.json();
        if (data.success) {
          setDeals(data.data.deals ?? []);
        } else {
          setDeals([]);
        }
        setCoupons([]);
      }
    } catch {
      setDeals([]);
      setCoupons([]);
    } finally {
      setLoading(false);
    }
  }, [activeCategory, featuredOnly]);

  // Read the URL state once on mount (see the state above).
  const dealsUrlInitRef = useRef(false);
  useEffect(() => {
    if (dealsUrlInitRef.current) return;
    dealsUrlInitRef.current = true;
    try {
      const params = new URLSearchParams(window.location.search);
      const type = params.get('type') ?? '';
      if (type) setActiveCategory(type);
      if (params.get('featured') === 'true') setFeaturedOnly(true);
      const s = params.get('sort');
      if (s === 'discount' || s === 'savings' || s === 'ending') setDealSort(s);
      const m = params.get('merchant');
      if (m) setMerchantFilter(m);
      const b = params.get('brand');
      if (b) setBrandFilter(b);
      const band = params.get('band');
      if (band === 'under-100' || band === '100-500' || band === '500-plus') setDealPriceBand(band);
      const md = params.get('minDiscount');
      if (md === '10' || md === '20' || md === '30') setMinDiscount(md);
      const p = Math.max(1, Number(params.get('page') ?? 1) || 1);
      if (p > 1) setDealsPage(p);
    } catch {
      // Defaults stand.
    }
  }, []);

  useEffect(() => {
    fetchDeals();
  }, [fetchDeals]);

  // Section 13: filter options derived from the fetched rows only
  // (merchant from the deal URL hostname, brand from the product;
  // coupons resolve their merchant through the merchant names).
  const merchantOptions = useMemo(() => {
    const set = new Set<string>();
    if (activeCategory === 'coupon') {
      for (const name of Object.values(merchantNames)) if (name) set.add(name);
    } else {
      for (const d of deals) {
        const host = dealMerchantHost(d);
        if (host) set.add(dealMerchantLabel(host));
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [deals, merchantNames, activeCategory]);

  const brandOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of deals) if (d.product?.brand) set.add(d.product.brand);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [deals]);

  // Section 13: sort + filters, applied client-side to the fetched
  // rows (the ranked endpoint returns AI order; the sort keys below
  // reorder the same rows — biggest % off, biggest $ saving, ending
  // soonest — from fields already on the cards). B14 adds the
  // minimum-discount filter (same discountPercentage field).
  const displayedDeals = useMemo(() => {
    let items = deals;
    if (merchantFilter) {
      items = items.filter((d) => {
        const host = dealMerchantHost(d);
        return host !== null && dealMerchantLabel(host) === merchantFilter;
      });
    }
    if (brandFilter) items = items.filter((d) => d.product?.brand === brandFilter);
    if (dealPriceBand !== 'all') {
      items = items.filter(
        (d) => d.currentPrice === null || d.currentPrice === undefined || inDealPriceBand(d.currentPrice, dealPriceBand)
      );
    }
    items = filterDealsByMinDiscount(items, minDiscount ? Number(minDiscount) : null);
    const sorted = [...items];
    switch (dealSort) {
      case 'discount':
        sorted.sort((a, b) => b.discountPercentage - a.discountPercentage);
        break;
      case 'savings':
        sorted.sort((a, b) => b.savingsAmount - a.savingsAmount);
        break;
      case 'ending':
        sorted.sort((a, b) => {
          const ea = a.deal ? new Date(a.deal.endAt).getTime() : Number.POSITIVE_INFINITY;
          const eb = b.deal ? new Date(b.deal.endAt).getTime() : Number.POSITIVE_INFINITY;
          return ea - eb;
        });
        break;
      default:
        break; // 'ai': the API's ranked order.
    }
    return sorted;
  }, [deals, merchantFilter, brandFilter, dealPriceBand, dealSort, minDiscount]);

  // B9: coupons respect the shared sort control too — the old code
  // only filtered them by merchant, so "Ending soonest" / "Biggest
  // % off" silently did nothing on the Coupons tab. 'discount' and
  // 'savings' order by the listed discount value (see lib/deal-list:
  // % and $ values are not converted into each other).
  const displayedCoupons = useMemo(() => {
    const filtered = !merchantFilter
      ? coupons
      : coupons.filter(
          (c) => c.merchantId !== null && merchantNames[c.merchantId] === merchantFilter
        );
    return sortCoupons(filtered, dealSort);
  }, [coupons, merchantFilter, merchantNames, dealSort]);

  const featuredDeals = deals.filter((d) => d.isFeatured);
  const regularDeals = deals.filter((d) => !d.isFeatured);

  const dealFiltersActive =
    dealSort !== 'ai' || merchantFilter !== '' || brandFilter !== '' || dealPriceBand !== 'all' || minDiscount !== '';
  // B7: pagination applies ALWAYS, not only when filters are on.
  // The old grid rendered the full unfiltered list (up to 30
  // fetched deals) and only paged the filtered list — page 2 of an
  // unfiltered view did not exist. The base list is the filtered
  // list when filters are active; otherwise it is the regular
  // (non-featured) deals, because featured deals already render in
  // the Featured section above — except when a category is selected
  // or Featured Only is on, when the Featured section is hidden and
  // the grid must show every fetched deal (featured included), or
  // the featured deals of that category would vanish entirely.
  const featuredShownSeparately =
    !activeCategory && !featuredOnly && featuredDeals.length > 0;
  const dealsBaseList = dealFiltersActive
    ? displayedDeals
    : featuredShownSeparately
      ? (regularDeals.length > 0 ? regularDeals : deals)
      : deals;
  const dealsTotalPages = Math.max(1, Math.ceil(dealsBaseList.length / DEALS_PAGE_SIZE));
  const dealsEffectivePage = Math.min(dealsPage, dealsTotalPages);
  const pagedDeals = paginateList(dealsBaseList, dealsEffectivePage, DEALS_PAGE_SIZE);

  // Section 13, Chunk E: ItemList of the product-linked deals on
  // the current page only (same pattern as the search page's result
  // ItemList). Deals without a product are excluded — they have no
  // product URL to list — and a product appearing in several deals
  // is listed once.
  const dealsItemListJsonLd = useMemo(() => {
    const seen = new Set<string>();
    const items: Array<{ name: string; path: string }> = [];
    for (const deal of pagedDeals) {
      if (!deal.product) continue;
      if (seen.has(deal.product.slug)) continue;
      seen.add(deal.product.slug);
      items.push({
        name: deal.product.name,
        path: `/products/${deal.product.slug}`,
      });
    }
    return items.length > 0
      ? toJsonLd(buildItemListJsonLd(appConfig.url, items))
      : null;
  }, [pagedDeals]);
  const couponsTotalPages = Math.max(1, Math.ceil(displayedCoupons.length / DEALS_PAGE_SIZE));
  const couponsEffectivePage = Math.min(dealsPage, couponsTotalPages);
  const pagedCoupons = displayedCoupons.slice(
    (couponsEffectivePage - 1) * DEALS_PAGE_SIZE,
    couponsEffectivePage * DEALS_PAGE_SIZE
  );

  const clearDealFilters = () => {
    setDealSort('ai');
    setMerchantFilter('');
    setBrandFilter('');
    setDealPriceBand('all');
    setMinDiscount('');
    setDealsPage(1);
    writeDealsUrl({ sort: 'ai', merchant: '', brand: '', band: 'all', minDiscount: '', page: 1 });
  };

  const goToDealsPage = (nextPage: number) => {
    setDealsPage(nextPage);
    writeDealsUrl({ page: nextPage });
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <SiteHeader />
      {dealsItemListJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: dealsItemListJsonLd }}
        />
      )}
      <div className="container mx-auto max-w-6xl px-4 py-8">
        <div className="mb-8 text-center">
          <h1 className="flex items-center justify-center gap-2 text-3xl font-bold sm:text-4xl">
            <Sparkles className="h-8 w-8 text-amber-500" />
            {tFor(language, 'pageHeadingDeals')}
          </h1>
          <p className="mt-2 text-muted-foreground">
            AI-ranked deals, flash sales, coupons, and hidden discounts
          </p>
          <p className="mx-auto mt-2 max-w-2xl text-xs text-muted-foreground">
            Percentages on deal cards are each deal&apos;s listed discount from our deals table. A
            product page may show a different saving, calculated from the retailer&apos;s
            compare-at price — the two bases are not the same number.
          </p>
          <p className="mx-auto mt-2 max-w-2xl text-xs text-muted-foreground">
            Follow these deals in a feed reader:{' '}
            <Link href="/deals/rss.xml" className="underline">
              Deals RSS feed
            </Link>
          </p>
          {/* Badge legend — what the "Verified" badge means, word-for-word
              from the fact-check source (lib/fact-check.ts). */}
          <div className="mx-auto mt-4 max-w-2xl rounded-lg border bg-card p-4 text-left">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Badge>Verified</Badge>
              <span>What this badge means</span>
            </p>
            <p className="mt-2 text-sm text-muted-foreground">{DEAL_VERIFIED_MEANING}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Full methodology:{' '}
              <Link href="/methodology" className="underline">
                How SmartBuy AI works
              </Link>
            </p>
          </div>
          {/* S3#10 — share this deals page (WhatsApp / X / Facebook /
              copy link + your own referral link). */}
          <div className="mt-5 flex justify-center">
            <ShareButtons
              title="SmartBuy AI deals — AI-ranked deals, flash sales and coupons"
              text="Check out these deals on SmartBuy AI"
              enableReferral
            />
          </div>
        </div>

        <div className="mb-6 flex flex-wrap items-center justify-center gap-2">
          {DEAL_CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            return (
              <Button
                key={cat.key}
                type="button"
                variant="outline"
                onClick={() => {
                  setActiveCategory(cat.key);
                  setDealsPage(1);
                  writeDealsUrl({ type: cat.key, page: 1 });
                }}
                className={cn(
                  // Touch target ≥44px (S3#22): min-h keeps the pill
                  // look while the hit area meets the minimum.
                  'flex h-auto min-h-[44px] items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-all',
                  activeCategory === cat.key
                    ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-600 hover:text-white'
                    : 'bg-card text-foreground hover:border-blue-300 dark:bg-muted'
                )}
              >
                <Icon className="h-4 w-4" />
                {cat.label}
              </Button>
            );
          })}
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const next = !featuredOnly;
              setFeaturedOnly(next);
              setDealsPage(1);
              writeDealsUrl({ featured: next, page: 1 });
            }}
            className={cn(
              'flex h-auto min-h-[44px] items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-all',
              featuredOnly
                ? 'border-amber-500 bg-amber-500 text-white hover:bg-amber-500 hover:text-white'
                : 'bg-card text-foreground hover:border-amber-300 dark:bg-muted'
            )}
          >
            <Sparkles className="h-4 w-4" />
            Featured Only
          </Button>
        </div>

        {/* Section 13: sort + filters + shareable URL state. The
            brand / price-band / sort controls apply to ranked deals;
            the merchant filter applies to coupons too (via the
            merchant names resolved for the Coupons tab). */}
        <div className="mb-6 flex flex-wrap items-center justify-center gap-2">
          <Select
            value={dealSort}
            onValueChange={(v) => {
              const next = v as DealSortKey;
              setDealSort(next);
              setDealsPage(1);
              writeDealsUrl({ sort: next, page: 1 });
            }}
          >
            <SelectTrigger aria-label="Sort deals" className="w-[200px]">
              <SelectValue placeholder="Sort: AI ranked" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ai">Sort: AI ranked</SelectItem>
              <SelectItem value="discount">Biggest % off</SelectItem>
              <SelectItem value="savings">Biggest $ saving</SelectItem>
              <SelectItem value="ending">Ending soonest</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={merchantFilter || 'all'}
            onValueChange={(v) => {
              const next = v === 'all' ? '' : v;
              setMerchantFilter(next);
              setDealsPage(1);
              writeDealsUrl({ merchant: next, page: 1 });
            }}
          >
            <SelectTrigger aria-label="Filter by merchant" className="w-[180px]">
              <SelectValue placeholder="All merchants" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All merchants</SelectItem>
              {merchantOptions.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {activeCategory !== 'coupon' && (
            <>
              <Select
                value={brandFilter || 'all'}
                onValueChange={(v) => {
                  const next = v === 'all' ? '' : v;
                  setBrandFilter(next);
                  setDealsPage(1);
                  writeDealsUrl({ brand: next, page: 1 });
                }}
              >
                <SelectTrigger aria-label="Filter by brand" className="w-[160px]">
                  <SelectValue placeholder="All brands" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All brands</SelectItem>
                  {brandOptions.map((b) => (
                    <SelectItem key={b} value={b}>{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={dealPriceBand}
                onValueChange={(v) => {
                  const next = v as DealPriceBand;
                  setDealPriceBand(next);
                  setDealsPage(1);
                  writeDealsUrl({ band: next, page: 1 });
                }}
              >
                <SelectTrigger aria-label="Filter by price band" className="w-[160px]">
                  <SelectValue placeholder="Any price" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any price</SelectItem>
                  <SelectItem value="under-100">Under $100</SelectItem>
                  <SelectItem value="100-500">$100 – $500</SelectItem>
                  <SelectItem value="500-plus">Over $500</SelectItem>
                </SelectContent>
              </Select>
              {/* B14: minimum discount — "at least 20% off" — from
                  the discountPercentage already on every deal. */}
              <Select
                value={minDiscount || 'any'}
                onValueChange={(v) => {
                  const next = v === 'any' ? '' : v;
                  setMinDiscount(next);
                  setDealsPage(1);
                  writeDealsUrl({ minDiscount: next, page: 1 });
                }}
              >
                <SelectTrigger aria-label="Filter by minimum discount" className="w-[160px]">
                  <SelectValue placeholder="Any discount" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any discount</SelectItem>
                  <SelectItem value="10">10% off or more</SelectItem>
                  <SelectItem value="20">20% off or more</SelectItem>
                  <SelectItem value="30">30% off or more</SelectItem>
                </SelectContent>
              </Select>
            </>
          )}
          {dealFiltersActive && (
            <Button type="button" variant="ghost" size="sm" onClick={clearDealFilters}>
              <X className="mr-1 h-4 w-4" /> Clear filters
            </Button>
          )}
        </div>

        {/* S5#13 — curated deal of the day for the visitor's
            region (honest empty state when nothing is curated yet)
            + the public curation rules. */}
        <div className="mb-8 grid gap-4 lg:grid-cols-2">
          <CuratedDealOfTheDay regionCode={region.code} />
          <CurationGuidelines />
        </div>

        {/* Seasonal events (S3#6): the three event pages. */}
        <div className="mb-8 flex flex-wrap items-center justify-center gap-2">
          <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <CalendarDays className="h-4 w-4" /> Seasonal events:
          </span>
          {SEASONAL_EVENTS.map((event) => (
            <Link
              key={event.slug}
              href={`/events/${event.slug}`}
              className="flex min-h-[44px] items-center rounded-full border px-4 py-2 text-sm font-medium transition-all hover:border-blue-300 hover:text-primary"
            >
              {event.name}
            </Link>
          ))}
          <Link
            href="/events"
            className="flex min-h-[44px] items-center rounded-full border px-4 py-2 text-sm font-medium transition-all hover:border-blue-300 hover:text-primary"
          >
            All events
          </Link>
        </div>

        {loading && (
          <div className="flex justify-center py-12">
            <LoadingSpinner size="lg" />
          </div>
        )}

        {!loading &&
          (activeCategory === 'coupon' ? displayedCoupons.length === 0 : displayedDeals.length === 0) && (
          <EmptyState
            title={
              activeCategory === 'coupon'
                ? 'No coupons available'
                : dealFiltersActive
                  ? 'No deals match your filters'
                  : 'No deals found'
            }
            description={
              activeCategory === 'coupon'
                ? 'No active coupon codes right now — check back later, or browse the deals above.'
                : dealFiltersActive
                  ? 'Nothing matches the sort or filters you selected. Clear them to see all deals again.'
                  : 'Check back later for new deals and discounts'
            }
            icon={Tag}
            action={
              // Section 13: a filter-caused empty state offers to
              // clear the filters; the original "find a product"
              // action stays for a genuinely empty catalog.
              dealFiltersActive ? (
                <Button variant="outline" onClick={clearDealFilters}>
                  Clear filters
                </Button>
              ) : (
              // Section 11, Chunk C: there is no product here to
              // attach a guest price alert to (alerts are per
              // product, via PriceAlertDialog), so the empty state
              // routes to Search instead of faking a "notify me".
              // The copy says so honestly: find a product, open it,
              // tap Set Alert — guest alerts are saved on this
              // device only, with no background checks.
              <div className="flex flex-col items-center gap-2">
                <Button asChild>
                  <Link href="/search">
                    <Bell className="mr-2 h-4 w-4" /> Find a product to watch
                  </Link>
                </Button>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Price alerts are set per product: find a product, open it and tap Set Alert.
                  Guest alerts are saved on this device only — nothing checks prices in the
                  background.
                </p>
              </div>
              )
            }
          />
        )}

        {!loading && activeCategory === 'coupon' && displayedCoupons.length > 0 && (
          <div>
            {/* Option 9: Auto-Coupon Hub — aggregated view of the SAME
                validity-filtered coupon source as the product rows, so
                the hub and the rows can never disagree. It receives
                the filtered list here, so hub and rows stay in sync
                when a merchant filter is on. */}
            <AutoCouponHub coupons={displayedCoupons} merchantNames={merchantNames} />
            <h2 className="mb-4 text-xl font-bold">Coupons</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Copy a code and paste it at the retailer&apos;s checkout — SmartBuy cannot apply codes inside a
              retailer&apos;s own checkout, so this one tap copies the code for you.
              {merchantFilter && ` Showing ${displayedCoupons.length} coupon${displayedCoupons.length !== 1 ? 's' : ''} for ${merchantFilter}.`}
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {pagedCoupons.map((coupon) => (
                <CouponCard
                  key={coupon.id}
                  coupon={coupon}
                  merchantName={coupon.merchantId ? merchantNames[coupon.merchantId] : undefined}
                />
              ))}
            </div>
            {couponsTotalPages > 1 && (
              <div className="mt-6 flex items-center justify-center gap-2">
                <Button variant="outline" size="sm" disabled={couponsEffectivePage <= 1} onClick={() => goToDealsPage(couponsEffectivePage - 1)}>
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {couponsEffectivePage} of {couponsTotalPages}
                </span>
                <Button variant="outline" size="sm" disabled={couponsEffectivePage >= couponsTotalPages} onClick={() => goToDealsPage(couponsEffectivePage + 1)}>
                  Next
                </Button>
              </div>
            )}
          </div>
        )}

        {!loading && displayedDeals.length > 0 && (
          <div className="space-y-8">
            {featuredDeals.length > 0 && !activeCategory && !featuredOnly && !dealFiltersActive && (
              <div>
                <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
                  <Sparkles className="h-5 w-5 text-amber-500" />
                  Featured Deals
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {featuredDeals.map((deal) => (
                    <DealCard key={deal.id} deal={deal} featured onClick={() => deal.product && router.push(`/products/${deal.product.slug}`)} />
                  ))}
                </div>
              </div>
            )}

            <div>
              <h2 className="mb-4 text-xl font-bold">
                {activeCategory ? DEAL_CATEGORIES.find((c) => c.key === activeCategory)?.label : 'All Deals'}
              </h2>
              {/* B7: the count + pager describe the paged base list
                  (see the dealsBaseList note above) — always, not
                  only when filters are on. */}
              {dealsBaseList.length > 0 && (
                <p className="mb-4 text-sm text-muted-foreground">
                  Showing {(dealsEffectivePage - 1) * DEALS_PAGE_SIZE + 1}–{(dealsEffectivePage - 1) * DEALS_PAGE_SIZE + pagedDeals.length} of {dealsBaseList.length} deal{dealsBaseList.length !== 1 ? 's' : ''}
                  {dealFiltersActive && displayedDeals.length !== deals.length && ` (of ${deals.length} before filters)`}
                </p>
              )}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {pagedDeals.map((deal) => (
                  <DealCard key={deal.id} deal={deal} onClick={() => deal.product && router.push(`/products/${deal.product.slug}`)} />
                ))}
              </div>
              {dealsTotalPages > 1 && (
                <div className="mt-6 flex items-center justify-center gap-2">
                  <Button variant="outline" size="sm" disabled={dealsEffectivePage <= 1} onClick={() => goToDealsPage(dealsEffectivePage - 1)}>
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {dealsEffectivePage} of {dealsTotalPages}
                  </span>
                  <Button variant="outline" size="sm" disabled={dealsEffectivePage >= dealsTotalPages} onClick={() => goToDealsPage(dealsEffectivePage + 1)}>
                    Next
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        <CommunityDeals />

        {/* Section 14, Chunk 1 — the Deal Hotspots Calendar was dead
            code (zero importers). It is self-fetching from the live
            /api/v1/deal-hotspots endpoint and shows RECORDED drops
            and deal starts only — no prediction — so it belongs here
            on /deals rather than in the bin. */}
        <div className="mt-8">
          <DealHotspotsCalendar />
        </div>

        {/* Section 13, item 51 — deal-alert capture on the deals
            page (capture only; sending starts once email delivery
            is configured — see lib/newsletter.ts). */}
        <div className="mt-8">
          <NewsletterCapture source="deals" />
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}

function CouponCard({ coupon, merchantName }: { coupon: Coupon; merchantName?: string }) {
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(coupon.code);
    } catch {
      // Clipboard blocked (insecure context): fall back to a
      // prompt-less selection is not possible here, so just mark
      // the code visibly — the user can long-press to copy it.
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const discountLabel =
    coupon.discountType === 'percentage' ? `${coupon.discountValue}% OFF` : `$${coupon.discountValue} OFF`;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <Badge className="bg-green-600">{discountLabel}</Badge>
          {merchantName && <span className="text-sm text-muted-foreground">{merchantName}</span>}
        </div>
        <div className="mt-3 rounded-md border border-dashed border-slate-300 p-2 text-center dark:border-slate-600">
          <span className="font-mono text-lg font-bold tracking-wider">{coupon.code}</span>
        </div>
        {coupon.description && <p className="mt-2 text-sm text-muted-foreground">{coupon.description}</p>}
        <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          {coupon.minOrderValue !== null && <p>Min order: ${coupon.minOrderValue}</p>}
          {coupon.maxDiscountAmount !== null && <p>Max discount: ${coupon.maxDiscountAmount}</p>}
          {coupon.validUntil && <p>Valid until: {new Date(coupon.validUntil).toLocaleDateString()}</p>}
        </div>
        <Button size="sm" className="mt-3 min-h-[44px] w-full" onClick={copyCode}>
          {copied ? (
            <>
              <Check className="mr-1 h-4 w-4" /> Copied!
            </>
          ) : (
            <>
              <Copy className="mr-1 h-4 w-4" /> Copy code
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

function DealCard({ deal, featured, onClick }: { deal: RankedDeal; featured?: boolean; onClick: () => void }) {
  // Fallback basis: when the deal row itself is missing, the
  // fallback value is the ranking's discountPercentage — a PERCENT,
  // not a dollar amount. The old code treated the fallback as a
  // fixed amount and rendered e.g. "$20 OFF" for a 20% deal.
  const discount = deal.deal?.discountValue ?? deal.discountPercentage;
  const isPercent = deal.deal ? deal.deal.discountType === 'percentage' : true;
  const endDate = deal.deal ? new Date(deal.deal.endAt) : null;
  const hoursLeft = endDate ? Math.round((endDate.getTime() - Date.now()) / (60 * 60 * 1000)) : null;
  const isFlash = deal.dealType === 'flash';
  // B8: merchant label for the outbound link, from the deal's own
  // URL hostname (same helper as the merchant filter above).
  const merchantHost = dealMerchantHost(deal);

  return (
    <Card
      className={cn(
        // Only a card with a product to open is clickable: a
        // product-less deal row used to show a pointer cursor and
        // do nothing on click (the page guards the navigation).
        deal.product ? 'cursor-pointer transition-all hover:shadow-lg' : 'transition-all',
        featured && 'border-amber-300 bg-gradient-to-br from-amber-50 to-white dark:border-amber-700 dark:from-amber-950 dark:to-slate-900',
        isFlash && 'border-red-200 dark:border-red-800'
      )}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="mb-3 flex items-start justify-between">
          <div className="flex flex-wrap gap-1.5">
            {featured && (
              <Badge className="bg-amber-500">
                <Sparkles className="mr-1 h-3 w-3" /> Featured
              </Badge>
            )}
            {isFlash && (
              <Badge className="bg-red-500">
                <Zap className="mr-1 h-3 w-3" /> Flash
              </Badge>
            )}
            {deal.deal?.couponCode && (
              <Badge variant="outline">
                <Tag className="mr-1 h-3 w-3" /> Coupon
              </Badge>
            )}
          </div>
          <Badge variant="secondary" className="bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
            AI Score: {Math.round(deal.aiScore)}
          </Badge>
        </div>

        {deal.product?.imageUrl && (
          <div className="relative mb-3 h-32 overflow-hidden rounded-lg bg-muted">
            {/* next/image with `unoptimized`: product image hosts are
                not in next.config remotePatterns (only Unsplash /
                Pexels are), so optimization would reject them at
                runtime — unoptimized keeps the same rendering while
                adopting next/image (dimensions + lazy loading). */}
            <Image
              src={deal.product.imageUrl}
              alt={deal.product.name}
              fill
              sizes="(max-width: 640px) 100vw, 33vw"
              className="object-cover"
              unoptimized
            />
          </div>
        )}

        <h3 className="font-semibold leading-tight">
          {deal.deal?.title ?? deal.product?.name ?? 'Deal'}
        </h3>

        {deal.product?.brand && (
          <p className="mt-0.5 text-sm text-muted-foreground">{deal.product.brand}</p>
        )}

        <div className="mt-3 flex items-center gap-2">
          {deal.currentPrice !== null && deal.currentPrice !== undefined ? (
            <Price usd={deal.currentPrice} className="text-2xl font-bold text-blue-600" />
          ) : (
            <span className="text-sm text-muted-foreground">Price not listed</span>
          )}
          <span className="text-lg font-bold text-green-600">
            {isPercent ? `${discount}%` : `$${discount}`} OFF
          </span>
          {deal.savingsAmount > 0 && (
            <span className="text-sm text-muted-foreground">
              Save <Price usd={deal.savingsAmount} showOriginal={false} />
            </span>
          )}
        </div>

        {/* Section 16, item 9: stale-price badge + age-in-days
            under the deal price (nothing when the freshness is
            unknown — e.g. an older cached response). */}
        {deal.currentPrice !== null && deal.currentPrice !== undefined && (
          <div className="mt-1">
            <StalePriceBadge dataFreshness={deal.product?.dataFreshness} />
          </div>
        )}

        {deal.deal?.couponCode && (
          <div className="mt-2 rounded-md border border-dashed border-slate-300 p-2 text-center dark:border-slate-600">
            <span className="font-mono text-sm font-bold tracking-wider">{deal.deal.couponCode}</span>
          </div>
        )}

        {hoursLeft !== null && hoursLeft > 0 && hoursLeft < 48 && (
          <div className="mt-2 flex items-center gap-1 text-sm text-red-600">
            <Clock className="h-3.5 w-3.5" />
            {hoursLeft}h left
          </div>
        )}

        {/* B8: the end date for longer-running deals (the countdown
            above only covers the last 48h), and "Ended" for a stale
            ranked row whose end passed — both from deal.endAt, never
            a guessed date. */}
        {endDate && hoursLeft !== null && hoursLeft >= 48 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Ends {endDate.toLocaleDateString()}
          </p>
        )}
        {endDate && hoursLeft !== null && hoursLeft <= 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Ended {endDate.toLocaleDateString()}
          </p>
        )}

        {deal.deal?.description && (
          <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{deal.deal.description}</p>
        )}

        {/* B8: outbound link to the retailer's deal page, from the
            deal's own URL. The card click still opens the SmartBuy
            product page, so the link stops propagation. No URL, no
            link — never a guessed retailer address. */}
        {deal.deal?.url && (
          <a
            href={deal.deal.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="mt-3 block text-center text-sm font-medium text-blue-600 underline underline-offset-2"
          >
            View deal at {merchantHost ? dealMerchantLabel(merchantHost) : 'retailer'} →
          </a>
        )}

        <Button size="sm" variant="outline" className="mt-3 min-h-[44px] w-full">
          View Deal <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
