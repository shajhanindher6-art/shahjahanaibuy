'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  bestCoupon,
  couponValueLabel,
  isCouponCurrentlyValid,
  COUPON_CHECKOUT_UNVERIFIED_LABEL,
  type DealCoupon,
} from '@/lib/deal-math';

/**
 * Auto-Coupon Hub — the aggregated view of the SAME validity-filtered
 * coupon source the product pages use. It is rendered at the top of
 * the deals page's Coupons tab (not a second coupons page), fed by
 * the coupons the page already fetched — so the hub and the product
 * rows can never disagree about which coupons are valid.
 *
 * HONESTY, enforced in the UI:
 * - Only currently-valid coupons are listed (expired, not-yet-valid,
 *   and usage-exhausted coupons are filtered by the shared helper).
 * - "Best per merchant" uses the same deterministic bestCoupon rule
 *   as the product rows. The hub never invents a code and never
 *   claims a code was negotiated or is "unlisted".
 * - Copy is one tap; the note repeats the standing boundary: a
 *   website cannot apply a code inside a retailer's checkout — the
 *   code is pasted there by the shopper (auto-apply exists only in
 *   the browser extension's checkout panel).
 */
export function AutoCouponHub({
  coupons,
  merchantNames,
}: {
  /** Coupons already fetched by the deals page (active-flag filtered). */
  coupons: Array<{
    code: string;
    merchantId: string | null;
    description: string | null;
    discountType: string;
    discountValue: number;
    validUntil: string | null;
  }>;
  merchantNames: Record<string, string>;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  const { valid, bestPerMerchant } = useMemo(() => {
    const mapped: DealCoupon[] = coupons.map((c) => ({
      code: c.code,
      merchantId: c.merchantId,
      description: c.description,
      discountType: c.discountType,
      discountValue: c.discountValue,
      validUntil: c.validUntil,
    }));
    const validList = mapped.filter((c) => isCouponCurrentlyValid(c));
    const byMerchant = new Map<string, DealCoupon[]>();
    for (const c of validList) {
      const key = c.merchantId ?? 'other';
      const list = byMerchant.get(key) ?? [];
      list.push(c);
      byMerchant.set(key, list);
    }
    const best: Array<{ merchantKey: string; coupon: DealCoupon }> = [];
    for (const [key, list] of byMerchant) {
      const b = bestCoupon(list);
      if (b) best.push({ merchantKey: key, coupon: b });
    }
    best.sort((a, b) => a.coupon.code.localeCompare(b.coupon.code));
    return { valid: validList, bestPerMerchant: best };
  }, [coupons]);

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Clipboard blocked: the code is still visible for manual copying.
    }
    setCopied(code);
    window.setTimeout(() => setCopied(null), 2000);
  }

  if (valid.length === 0) {
    return (
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Auto-Coupon Hub</CardTitle>
          <CardDescription>
            No currently-valid coupon codes right now. Expired or not-yet-valid codes are never
            listed as active — check back later.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-base">Auto-Coupon Hub</CardTitle>
        <CardDescription>
          {valid.length} coupon code{valid.length !== 1 ? 's' : ''} across{' '}
          {bestPerMerchant.length} merchant{bestPerMerchant.length !== 1 ? 's' : ''}, from the same
          validity-filtered source as the product pages — so this hub and the product rows always
          agree. &quot;Valid&quot; here means only that the code passed our own check (active flag,
          validity dates, usage limit) against the codes stored in our database: we have not
          verified these codes with the retailer, and the retailer decides whether a code works at
          checkout. Tap a code to copy it, then paste it at the retailer&apos;s checkout: SmartBuy
          cannot apply codes inside a retailer&apos;s checkout (auto-apply exists only in the
          browser extension&apos;s checkout panel). No code here was negotiated and none is
          &quot;unlisted&quot;.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {bestPerMerchant.map(({ merchantKey, coupon }) => (
          <div
            key={merchantKey}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
          >
            <div>
              <p className="font-medium">
                {merchantKey === 'other' ? 'All merchants' : (merchantNames[merchantKey] ?? 'Merchant')}
              </p>
              <p className="text-sm text-muted-foreground">
                Best valid code: {couponValueLabel(coupon)}
                {coupon.description ? ` · ${coupon.description}` : ''}
                {coupon.validUntil
                  ? ` · Valid until ${new Date(coupon.validUntil).toLocaleDateString()}`
                  : ''}
              </p>
              {/* Section 19, Phase 2 (§12 #22): "valid" here is an
                  expiry-date check only — the code has not been
                  confirmed to work at the merchant checkout. */}
              <p className="text-xs text-muted-foreground">{COUPON_CHECKOUT_UNVERIFIED_LABEL}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-auto rounded border-dashed border-green-300 bg-green-50 px-2 py-1 font-mono text-xs font-bold text-green-700 hover:bg-green-50 hover:text-green-700 dark:border-green-700 dark:bg-green-950 dark:text-green-300 dark:hover:bg-green-950 dark:hover:text-green-300"
              title="Copy coupon code — paste it at the retailer's checkout"
              onClick={() => copyCode(coupon.code)}
            >
              {copied === coupon.code ? 'Copied!' : `${coupon.code} (tap to copy)`}
            </Button>
          </div>
        ))}
        {valid.length > bestPerMerchant.length && (
          <p className="text-xs text-muted-foreground">
            Showing the best valid code per merchant above; the full list of {valid.length} valid
            codes is in the Coupons grid below.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
