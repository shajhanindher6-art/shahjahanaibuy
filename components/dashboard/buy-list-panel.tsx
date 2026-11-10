/**
 * Buy-list panel (Section 6, Item 1 — trimmed).
 *
 * STANDALONE — not mounted anywhere yet. A wave-2 integrator mounts
 * it on the dashboard and passes the list from
 * GET /api/v1/buy-list (prices are re-read at view time by the API;
 * this panel never stores or invents a price).
 *
 * This is a SHORTLIST, not a checkout: the panel says so on every
 * render — the user checks out at the retailer via the Where-to-Buy
 * link. Retailer links use the same buyHref logic as the product
 * page (localizeAmazonUrl): Amazon search links are rewritten to
 * the visitor region's Amazon domain, other retailer links pass
 * through unchanged.
 */

'use client';

import Link from 'next/link';
import { ShoppingCart, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Price } from '@/components/region/price';
import { REGIONS, localizeAmazonUrl } from '@/lib/region';
import type { BuyListItemView } from '@/lib/buy-list';

export function BuyListPanel({
  items,
  loading = false,
  regionCode = 'US',
  onRemove,
  onQuantityChange,
}: {
  /** Rows from GET /api/v1/buy-list (live prices already re-read). */
  items: BuyListItemView[];
  loading?: boolean;
  /** Visitor region code for the Amazon domain rewrite (default US). */
  regionCode?: string;
  onRemove?: (id: string) => void;
  onQuantityChange?: (id: string, quantity: number) => void;
}) {
  const region = REGIONS.find((r) => r.code === regionCode) ?? REGIONS[0];

  return (
    <section id="buy-list" className="animate-fade-in motion-reduce:animate-none">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
        <ShoppingCart className="h-5 w-5 text-blue-600" /> Buy list
      </h2>
      <p className="-mt-2 mb-4 text-xs text-muted-foreground">
        You check out at the retailer — SmartBuy never charges you.
      </p>
      {loading ? (
        <div className="glass-card h-32 animate-shimmer" />
      ) : items.length === 0 ? (
        <div className="glass-card p-6 text-center">
          <p className="text-sm font-medium">Your buy list is empty</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Save products here to shortlist them. Prices are re-checked from the retailer when you
            view this list — nothing here is a checkout.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const buyHref =
              (item.buyUrl ? localizeAmazonUrl(item.buyUrl, region) : null) ?? item.buyUrl ?? null;
            const name = item.productName ?? 'Product';
            return (
              <div
                key={item.id}
                className="glass-card flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0">
                  {item.productSlug ? (
                    <Link
                      href={`/products/${item.productSlug}`}
                      className="truncate text-sm font-medium hover:underline"
                    >
                      {name}
                    </Link>
                  ) : (
                    <p className="truncate text-sm font-medium">{name}</p>
                  )}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {item.merchantName ? `${item.merchantName} · ` : ''}
                    {item.livePriceUsd !== null ? (
                      <>
                        <Price usd={item.livePriceUsd} />{' '}
                        <span className="text-muted-foreground">(latest recorded price)</span>
                      </>
                    ) : (
                      'Price not recorded'
                    )}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <label htmlFor={`buy-list-qty-${item.id}`} className="text-xs text-muted-foreground">
                      Qty
                    </label>
                    <select
                      id={`buy-list-qty-${item.id}`}
                      value={item.quantity}
                      onChange={(e) => onQuantityChange?.(item.id, Number(e.target.value))}
                      className="rounded border border-slate-200 bg-transparent px-1 py-0.5 text-sm dark:border-slate-700"
                    >
                      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {buyHref ? (
                    <Button asChild>
                      <a href={buyHref} target="_blank" rel="noopener noreferrer">
                        Buy at retailer
                      </a>
                    </Button>
                  ) : (
                    <Badge variant="secondary">No retailer link recorded</Badge>
                  )}
                  {onRemove && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${name} from buy list`}
                      onClick={() => onRemove(item.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
