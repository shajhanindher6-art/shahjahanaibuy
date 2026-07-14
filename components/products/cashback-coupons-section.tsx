'use client';

import { useState, useEffect, useCallback } from 'react';
import { Tag, DollarSign, Copy, Check, ExternalLink, Percent } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

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
}

export function CashbackCouponsSection({ productId }: CashbackCouponsSectionProps) {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [cashback, setCashback] = useState<CashbackOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const { toast } = useToast();

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
      {coupons.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Tag className="h-5 w-5 text-blue-500" />
              Available Coupons
            </CardTitle>
            <CardDescription>Apply these codes at checkout for instant savings</CardDescription>
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
                        {coupon.discountType === 'percentage'
                          ? `${coupon.discountValue}% OFF`
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
