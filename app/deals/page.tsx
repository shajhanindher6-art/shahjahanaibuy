'use client';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Tag, Zap, Clock, TrendingDown, Sparkles, ChevronRight, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';

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
  const [deals, setDeals] = useState<RankedDeal[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [merchantNames, setMerchantNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('');
  const [featuredOnly, setFeaturedOnly] = useState(false);

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

  useEffect(() => {
    fetchDeals();
  }, [fetchDeals]);

  const featuredDeals = deals.filter((d) => d.isFeatured);
  const regularDeals = deals.filter((d) => !d.isFeatured);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <SiteHeader />
      <div className="container mx-auto max-w-6xl px-4 py-8">
        <div className="mb-8 text-center">
          <h1 className="flex items-center justify-center gap-2 text-3xl font-bold sm:text-4xl">
            <Sparkles className="h-8 w-8 text-amber-500" />
            Smart Deal Finder
          </h1>
          <p className="mt-2 text-muted-foreground">
            AI-ranked deals, flash sales, coupons, and hidden discounts
          </p>
        </div>

        <div className="mb-6 flex flex-wrap items-center justify-center gap-2">
          {DEAL_CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            return (
              <button
                key={cat.key}
                onClick={() => setActiveCategory(cat.key)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-all',
                  activeCategory === cat.key
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                )}
              >
                <Icon className="h-4 w-4" />
                {cat.label}
              </button>
            );
          })}
          <button
            onClick={() => setFeaturedOnly(!featuredOnly)}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-all',
              featuredOnly
                ? 'border-amber-500 bg-amber-500 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:border-amber-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
            )}
          >
            <Sparkles className="h-4 w-4" />
            Featured Only
          </button>
        </div>

        {loading && (
          <div className="flex justify-center py-12">
            <LoadingSpinner size="lg" />
          </div>
        )}

        {!loading && deals.length === 0 && coupons.length === 0 && (
          <EmptyState
            title={activeCategory === 'coupon' ? 'No coupons available' : 'No deals found'}
            description={
              activeCategory === 'coupon'
                ? 'No active coupon codes right now — check back later, or browse the deals above.'
                : 'Check back later for new deals and discounts'
            }
            icon={Tag}
          />
        )}

        {!loading && activeCategory === 'coupon' && coupons.length > 0 && (
          <div>
            <h2 className="mb-4 text-xl font-bold">Coupons</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Copy a code and paste it at the retailer&apos;s checkout — SmartBuy cannot apply codes inside a
              retailer&apos;s own checkout, so this one tap copies the code for you.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {coupons.map((coupon) => (
                <CouponCard
                  key={coupon.id}
                  coupon={coupon}
                  merchantName={coupon.merchantId ? merchantNames[coupon.merchantId] : undefined}
                />
              ))}
            </div>
          </div>
        )}

        {!loading && deals.length > 0 && (
          <div className="space-y-8">
            {featuredDeals.length > 0 && !activeCategory && !featuredOnly && (
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
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {(featuredOnly ? deals : regularDeals.length > 0 ? regularDeals : deals).map((deal) => (
                  <DealCard key={deal.id} deal={deal} onClick={() => deal.product && router.push(`/products/${deal.product.slug}`)} />
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
        <Button size="sm" className="mt-3 w-full" onClick={copyCode}>
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
  const discount = deal.deal?.discountValue ?? deal.discountPercentage;
  const isPercent = deal.deal?.discountType === 'percentage';
  const endDate = deal.deal ? new Date(deal.deal.endAt) : null;
  const hoursLeft = endDate ? Math.round((endDate.getTime() - Date.now()) / (60 * 60 * 1000)) : null;
  const isFlash = deal.dealType === 'flash';

  return (
    <Card
      className={cn(
        'cursor-pointer transition-all hover:shadow-lg',
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
          <div className="mb-3 h-32 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
            <img src={deal.product.imageUrl} alt={deal.product.name} className="h-full w-full object-cover" />
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
            <span className="text-2xl font-bold text-blue-600">
              ${deal.currentPrice.toFixed(2)}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">Price not listed</span>
          )}
          <span className="text-lg font-bold text-green-600">
            {isPercent ? `${discount}%` : `$${discount}`} OFF
          </span>
          {deal.savingsAmount > 0 && (
            <span className="text-sm text-muted-foreground">
              Save ${deal.savingsAmount.toFixed(2)}
            </span>
          )}
        </div>

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

        {deal.deal?.description && (
          <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{deal.deal.description}</p>
        )}

        <Button size="sm" variant="outline" className="mt-3 w-full">
          View Deal <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
