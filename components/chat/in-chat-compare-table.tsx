/**
 * In-chat compare table (S5#2 — conversational commerce).
 *
 * When an assistant turn lists 2–3 products for a compare question,
 * the widget renders this compact table instead of stacked product
 * cards: product, brand, recorded price, and which one is cheapest.
 *
 * HONESTY RULES:
 * - Prices are the recorded merchant prices the engine returned
 *   (USD, region-formatted here). A product with no recorded price
 *   shows "Not recorded" and is NEVER the cheapest — an unpriced
 *   product cannot win on price.
 * - "Cheapest" is computed only from real prices present in the
 *   table. With fewer than 2 priced products, no cheapest badge
 *   is shown at all.
 * - The table covers at most 3 products; extra products fall back
 *   to the card list in the widget.
 */

'use client';

import Link from 'next/link';
import { formatPriceForRegion, formatUsd, type Region } from '@/lib/region';
import { cn } from '@/lib/utils';

export interface CompareTableProduct {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  price: number | null;
}

/** Lowest real price in the table, or null when fewer than 2 are priced. */
export function cheapestPrice(products: CompareTableProduct[]): number | null {
  const priced = products
    .map((p) => p.price)
    .filter((p): p is number => typeof p === 'number' && Number.isFinite(p));
  if (priced.length < 2) return null;
  return Math.min(...priced);
}

export function InChatCompareTable({
  products,
  region,
}: {
  products: CompareTableProduct[];
  region: Region;
}) {
  const cheapest = cheapestPrice(products);

  return (
    <div className="mt-2 overflow-hidden rounded-md border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
            <th scope="col" className="px-2 py-1.5 font-medium">Product</th>
            <th scope="col" className="px-2 py-1.5 font-medium">Price</th>
            <th scope="col" className="px-2 py-1.5 font-medium" aria-label="Cheapest marker" />
          </tr>
        </thead>
        <tbody>
          {products.map((p) => {
            const isCheapest = cheapest !== null && p.price === cheapest;
            const { display, approximate } = p.price !== null
              ? formatPriceForRegion(p.price, region)
              : { display: '', approximate: false };
            return (
              <tr
                key={p.id}
                className={cn(
                  'border-b border-slate-100 last:border-0 dark:border-slate-800',
                  isCheapest && 'bg-green-50 dark:bg-green-950/40'
                )}
              >
                <td className="px-2 py-1.5">
                  <Link
                    href={`/products/${p.slug}`}
                    className="font-medium text-slate-800 hover:text-blue-600 dark:text-slate-100 dark:hover:text-blue-400"
                  >
                    {p.name}
                  </Link>
                  {p.brand && (
                    <span className="block text-slate-500 dark:text-slate-400">{p.brand}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-green-600">
                  {p.price === null ? (
                    <span className="font-normal text-slate-500 dark:text-slate-400">Not recorded</span>
                  ) : approximate ? (
                    <>
                      ≈ {display}{' '}
                      <span className="text-[10px] font-normal text-slate-500 dark:text-slate-400">
                        {formatUsd(p.price)}
                      </span>
                    </>
                  ) : (
                    display
                  )}
                </td>
                <td className="px-2 py-1.5 text-right">
                  {isCheapest && (
                    <span className="rounded-full bg-green-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      Cheapest
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-slate-100 px-2 py-1 text-[10px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
        Prices are the lowest recorded merchant prices — not live retailer prices. Open a product
        for the full comparison.
      </p>
    </div>
  );
}

export default InChatCompareTable;
