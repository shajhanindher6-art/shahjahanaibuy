'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Tag, DollarSign, Copy, Check, ExternalLink, Percent } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { effectivePrice } from '@/lib/effective-price';
import { bestCoupon, type DealCoupon } from '@/lib/deal-math';

interface Coupon {
  id: string;
  code: string;
  description: string | null;
  discountType: string;
  discountValue: number;
  minOrderValue: number | null;
  validUntil: string | null;
  merchant?: { name: string } | null;
}

interface CashbackOffer {
  id: string;
  title: string;
  description: string | null;
  cashbackType: string;
  cashbackValue: number;
  maxCashbackAmount: number | null;
  termsUrl: string | null;
  merchant?: { name: string } | null;
}

interface CashbackCouponsSectionProps {
  productId?: string;
  /**
   * Current selling price (cheapest merchant listing) and its
   * compare-at price, from the product page. Both are needed for
   * the stacked "you pay" line (B6); when they are absent the
   * coupon/cashback lists below still render, just without it.
   */
  price?: number | null;
  compareAtPrice?: number | null;
}

export function CashbackCouponsSection({ productId, price, compareAtPrice }: CashbackCouponsSectionProps) {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [cashback, setCashback] = useState<CashbackOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const { toast } = useToast();

  // B6: stacked effective price — deal + best currently-valid
  // coupon + percentage cashback, each labelled. Shown only when
  // a coupon or cashback actually applies: a deal alone adds
  // nothing new (the selling price already IS the deal price).
  // The coupon is the same bestCoupon the Where-to-Buy rows use
  // (expired / inactive / usage-exhausted codes never apply).
  const stacked = useMemo(() => {
    if (price === null || price === undefined || !Number.isFinite(price) || price <= 0) {
      return null;
    }
    const coupon = bestCoupon(
      coupons.map(
        (c): DealCoupon => ({
          code: c.code,
          discountType: c.discountType,
          discountValue: c.discountValue,
          validUntil: c.validUntil,
          active: true,
        })
      )
    );
    const cashbackPct =
      cashback.find((o) => o.cashbackType === 'percentage')?.cashbackValue ?? null;
    return effectivePrice({
      price,
      listPrice: compareAtPrice ?? null,
      coupon: coupon
        ? { code: coupon.code, discountType: coupon.discountType, discountValue: coupon.discountValue }
        : null,
      cashbackPct,
    });
  }, [price, compareAtPrice, coupons, cashback]);
  const showStacked =
    stacked !== null && (stacked.couponApplied !== null || stacked.cashbackAmount > 0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ pageSize: '10' });
    if (productId) params.set('productId', productId);

    const [couponsRes, cashbackRes] = await Promise.all([
      fetch(`/api/v1/coupons?${params}`).catch(() => null),
      fetch(`/api/v1/cashback?${params}`).catch(() => null),
    ]);

    try {
      if (couponsRes && couponsRes.ok) {
        const data = await couponsRes.json();
        if (data.success) setCoupons(data.data ?? []);
      }
    } catch { setCoupons([]); }

    try {
      if (cashbackRes && cashbackRes.ok) {
        const data = await cashbackRes.json();
        if (data.success) setCashback(data.data ?? []);
      }
    } catch { setCashback([]); }

    setLoading(false);
  }, [productId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      toast({ title: 'Coupon copied!', description: code });
      setTimeout(() => setCopiedCode(null), 2000);
    } catch {
      toast({ title: 'Failed to copy', variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex justify-center"><LoadingSpinner /></div>
        </CardContent>
      </Card>
    );
  }

  if (coupons.length === 0 && cashback.length === 0) {
    return (
      <Card>
        <CardContent className="py-6">
          <EmptyState
            icon={Tag}
            title="No coupons or cashback available"
            description="Check back later for savings opportunities on this product."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* B6: stacked "you pay" line — deal + coupon + cashback in
          one place, each component labelled. An ESTIMATE: the coupon
          applies at the retailer's checkout, not inside SmartBuy,
          and cashback depends on the offer's terms. */}
      {showStacked && stacked && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Percent className="h-5 w-5 text-green-600" />
              You pay ${stacked.youPay.toFixed(2)} after deal + coupon + cashback
            </CardTitle>
            <CardDescription>
              Estimate — the coupon applies at the retailer&apos;s
              checkout, not inside SmartBuy, and cashback depends on
              the offer&apos;s terms.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">List price</span>
                <span>${stacked.listPrice.toFixed(2)}</span>
              </div>
              {stacked.dealSaving > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Deal saving{stacked.dealPct !== null ? ` (${stacked.dealPct}%)` : ''}
                  </span>
                  <span className="text-green-700">−${stacked.dealSaving.toFixed(2)}</span>
                </div>
              )}
              {stacked.couponApplied && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Coupon {stacked.couponApplied.code}
                  </span>
                  <span className="text-green-700">−${stacked.couponSaving.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">You pay at checkout</span>
                <span>${stacked.afterCoupon.toFixed(2)}</span>
              </div>
              {stacked.cashbackAmount > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Cashback{stacked.cashbackPct !== null ? ` (${stacked.cashbackPct}%)` : ''}
                  </span>
                  <span className="text-green-700">−${stacked.cashbackAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between border-t pt-2 font-semibold">
                <span>You pay (after cashback)</span>
                <span>${stacked.youPay.toFixed(2)}</span>
              </div>
              {stacked.totalSaving > 0 && (
                <p className="pt-1 text-xs text-muted-foreground">
                  Total saving vs list price: ${stacked.totalSaving.toFixed(2)}.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {coupons.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Tag className="h-5 w-5 text-blue-500" />
              Available Coupons
            </CardTitle>
            <CardDescription>Copy a code and paste it at the retailer&apos;s checkout — SmartBuy cannot apply codes inside a retailer&apos;s checkout, and a code may not apply to every order</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {coupons.map((coupon) => (
                <div
                  key={coupon.id}
                  className="flex items-center justify-between rounded-lg border border-dashed border-slate-300 p-3 dark:border-slate-600"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold tracking-wider">{coupon.code}</span>
                      <Badge variant="secondary" className="text-xs">
                        {/* Section 20, §12 #40 — claimed % vs list price, never a verified saving. */}
                        {coupon.discountType === 'percentage'
                          ? `${coupon.discountValue}% OFF vs list price`
                          : `$${coupon.discountValue} OFF`}
                      </Badge>
                    </div>
                    {coupon.description && (
                      <p className="mt-1 text-xs text-muted-foreground">{coupon.description}</p>
                    )}
                    {coupon.validUntil && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Expires {new Date(coupon.validUntil).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleCopyCode(coupon.code)}
                    className="ml-2 flex-shrink-0"
                  >
                    {copiedCode === coupon.code ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {cashback.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="h-5 w-5 text-green-500" />
              Cashback Offers
            </CardTitle>
            <CardDescription>Earn money back on your purchase</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {cashback.map((offer) => (
                <div
                  key={offer.id}
                  className="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950/50"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm">{offer.title}</span>
                    <Badge className="bg-green-600">
                      {offer.cashbackType === 'percentage'
                        ? `${offer.cashbackValue}%`
                        : `$${offer.cashbackValue}`}
                    </Badge>
                  </div>
                  {offer.description && (
                    <p className="mt-1 text-xs text-muted-foreground">{offer.description}</p>
                  )}
                  {offer.maxCashbackAmount && (
                    <p className="mt-0.5 text-xs text-green-700 dark:text-green-400">
                      Up to ${offer.maxCashbackAmount.toFixed(2)} cashback
                    </p>
                  )}
                  {offer.termsUrl && (
                    <a
                      href={offer.termsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1.5 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                    >
                      Terms apply <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
