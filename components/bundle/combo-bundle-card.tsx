'use client';

import Link from 'next/link';
import { Package } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Price } from '@/components/region/price';
import type { BundleItemInput, BundleTotals } from '@/lib/bundles';

/**
 * One combo bundle card (Section 3, item 5).
 *
 * The bundle price is the sum of the items' real lowest recorded
 * merchant prices. Savings are shown ONLY when real compare-at
 * prices were recorded — otherwise the card says plainly that no
 * bundle discount is recorded. Unpriced items are listed as
 * unpriced and the total is labeled a lower bound. No discount %
 * is ever invented.
 */
export function ComboBundleCard({
  items,
  totals,
}: {
  items: BundleItemInput[];
  totals: BundleTotals;
}) {
  const hasSavings = totals.savingsUsd > 0;
  const hasUnpriced = totals.unpricedSlugs.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Package className="h-5 w-5 text-sky-600" /> Combo bundle
        </CardTitle>
        <CardDescription>
          Real compatible products from the catalogue, priced from their recorded merchant
          listings. No bundle-only discount is invented.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li
              key={item.slug}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
            >
              <div>
                <Link href={`/products/${item.slug}`} className="font-medium hover:underline">
                  {item.name}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {i === 0 ? 'Main product' : `${item.grade ?? 'Unknown'}: ${item.gradeNote ?? 'Compatibility unknown — check specs before buying.'}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {i > 0 && item.grade && (
                  <Badge variant={item.grade === 'Likely' ? 'default' : item.grade === 'Possible' ? 'secondary' : 'outline'}>
                    {item.grade}
                  </Badge>
                )}
                {item.lowestPriceUsd !== null ? (
                  <span className="text-sm font-medium">
                    <Price usd={item.lowestPriceUsd} />
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">Price not recorded</span>
                )}
              </div>
            </li>
          ))}
        </ul>

        <div className="rounded-lg bg-muted/50 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">
              Bundle total{hasUnpriced ? ' (lower bound — some items unpriced)' : ''}
            </span>
            <span className="font-semibold">
              <Price usd={totals.totalUsd} />
            </span>
          </div>
          {hasSavings && totals.compareAtTotalUsd > 0 && (
            <div className="mt-1 flex items-center justify-between">
              <span className="text-muted-foreground">Bought separately (compare-at prices)</span>
              <span className="line-through">
                <Price usd={totals.compareAtTotalUsd} />
              </span>
            </div>
          )}
          {hasSavings ? (
            <p className="mt-1 text-emerald-700 dark:text-emerald-400">
              You save <Price usd={totals.savingsUsd} /> vs the recorded compare-at prices.
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              No bundle discount recorded — the total is the sum of the recorded prices.
            </p>
          )}
          {hasUnpriced && (
            <p className="mt-1 text-xs text-muted-foreground">
              {totals.unpricedSlugs.length} item(s) have no recorded price, so the total above
              is a lower bound until they are priced.
            </p>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Compatibility grades are a catalogue heuristic (brand + category), not a manufacturer
          compatibility statement. Verify connectors and specs with the manufacturer before
          buying. Prices are recorded demo prices — the retailer sets the final price at
          checkout.
        </p>
      </CardContent>
    </Card>
  );
}
