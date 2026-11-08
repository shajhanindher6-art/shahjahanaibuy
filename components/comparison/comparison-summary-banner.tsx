'use client';

import { useEffect, useState } from 'react';
import { BatteryCharging, Cpu, Trophy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Price } from '@/components/region/price';
import { fetchProductAttributes } from '@/lib/fetch-product-attributes';
import {
  buildComparisonBadges,
  type ComparisonBadge,
} from '@/services/comparison-summary';
import type { ProductAttribute } from '@/types/catalog';

/**
 * A product as the Summary Banner consumes it — structurally the
 * same shape the compare page already holds (extra fields on the
 * caller's objects are fine; only these fields are read).
 */
export interface SummaryBannerProduct {
  productId: string;
  slug: string;
  name: string;
  retailers: Array<{ price: number }>;
}

function lowestPriceUsd(retailers: Array<{ price: number }>): number | null {
  let min: number | null = null;
  for (const r of retailers) {
    if (!Number.isFinite(r.price) || r.price <= 0) continue;
    if (min === null || r.price < min) min = r.price;
  }
  return min;
}

/**
 * Comparison Summary Banner — Option 14-B.
 *
 * Badges earned deterministically from REAL data only (see
 * services/comparison-summary.ts for the rules): "Best for Battery
 * Life", "Best Value for Money", "Best for Multitasking". Each badge
 * names the winning product and the value that earned it.
 *
 * Attributes are loaded per product from the existing public
 * endpoint GET /api/v1/products/[slug] (attributes[]); prices come
 * from the comparison data already on the page. While loading, while
 * the endpoint is unreachable, or when zero badges are earned, this
 * renders NOTHING — a banner that cannot be earned must not occupy
 * space or imply a winner.
 */
export function ComparisonSummaryBanner({ products }: { products: SummaryBannerProduct[] }) {
  const [badges, setBadges] = useState<ComparisonBadge[] | null>(null);

  useEffect(() => {
    if (products.length < 2) return;
    let cancelled = false;
    (async () => {
      const results = await Promise.all(products.map((p) => fetchProductAttributes(p.slug)));
      if (cancelled) return;
      if (results.every((r) => !r.ok)) {
        // Endpoint unreachable for every product: no badges can be
        // earned honestly, so the banner stays hidden.
        setBadges([]);
        return;
      }
      const inputs = products.map((p, i) => ({
        productId: p.productId,
        name: p.name,
        lowestPriceUsd: lowestPriceUsd(p.retailers),
        attributes: (results[i].attributes ?? []) as ProductAttribute[],
      }));
      setBadges(buildComparisonBadges(inputs));
    })();
    return () => {
      cancelled = true;
    };
  }, [products]);

  if (products.length < 2 || badges === null || badges.length === 0) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950"
      role="status"
      aria-label="Comparison highlights"
    >
      {badges.map((badge) => {
        const Icon =
          badge.kind === 'battery' ? BatteryCharging : badge.kind === 'value' ? Trophy : Cpu;
        return (
          <Badge
            key={badge.kind}
            className="flex items-center gap-1.5 bg-yellow-500 px-3 py-1.5 text-xs text-slate-950 hover:bg-yellow-500"
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="font-semibold">{badge.label}:</span>
            <span>{badge.productName}</span>
            <span className="font-normal opacity-80">
              {badge.kind === 'value' ? (
                <>
                  <Price usd={badge.priceUsd} /> lowest price
                </>
              ) : (
                `${badge.detail}`
              )}
            </span>
          </Badge>
        );
      })}
    </div>
  );
}
