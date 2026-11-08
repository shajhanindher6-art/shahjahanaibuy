/**
 * Shopping digest grid (Enterprise #13) — AI Glass dashboard.
 *
 * One fetch (GET /api/v1/dashboard/digest) renders three columns:
 * saved items with current prices, price-drop alerts with trigger
 * status, and vector-matched recommendations. Each column has an
 * honest empty state; a failed fetch hides the whole section
 * instead of showing demo data — same rule as the other dashboard
 * sections.
 *
 * Recommendations are labelled "Similar to …" with their real
 * similarity — never "95%+ match" (that bar applies only to the
 * budget-alternative slot, which needs >= 0.95).
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, Heart, Sparkles, TrendingDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Price } from '@/components/region/price';
import type { DigestData } from '@/app/api/v1/dashboard/digest/route';

export function DigestGrid() {
  const [data, setData] = useState<DigestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/v1/dashboard/digest')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled) return;
        if (json?.success && json.data) setData(json.data as DigestData);
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) return null;

  return (
    <section
      id="shopping-digest"
      className="animate-fade-in motion-reduce:animate-none"
      style={{ animationDelay: '300ms' }}
    >
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
        <Sparkles className="h-5 w-5 text-violet-600" /> Your shopping digest
      </h2>
      {loading ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="glass-card animate-shimmer h-40" />
          ))}
        </div>
      ) : !data ? null : (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Saved items */}
          <div className="glass-card p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Heart className="h-4 w-4 text-rose-500" /> Saved items
              <Badge variant="secondary">{data.summary.savedCount}</Badge>
            </h3>
            {data.savedItems.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Nothing saved yet — add products to a wishlist and they will show here with their current prices.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {data.savedItems.slice(0, 4).map((item) => (
                  <li key={item.itemId}>
                    <Link href={`/products/${item.productSlug}`} className="block rounded-md p-1 transition-colors hover:bg-muted/50">
                      <span className="block truncate text-sm font-medium">{item.productName}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {item.currentPrice !== null ? (
                          <span className="font-semibold text-foreground">
                            <Price usd={item.currentPrice} />
                          </span>
                        ) : (
                          <span>Price not listed</span>
                        )}
                        {item.changePct !== null && item.changePct < 0 && (
                          <span className="flex items-center gap-0.5 text-emerald-600">
                            <TrendingDown className="h-3 w-3" />
                            {Math.abs(item.changePct).toFixed(1)}% drop
                          </span>
                        )}
                        {item.belowTarget && <Badge>Below target</Badge>}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Price-drop alerts */}
          <div className="glass-card p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Bell className="h-4 w-4 text-amber-500" /> Price-drop alerts
              <Badge variant="secondary">{data.summary.activeAlerts} active</Badge>
            </h3>
            {data.alerts.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">
                No alerts yet — set a price target on a product page and this digest will watch it for you.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {data.alerts.slice(0, 4).map((alert) => (
                  <li key={alert.id} className="rounded-md p-1">
                    <span className="block truncate text-sm font-medium">{alert.productName}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant={alert.active ? 'default' : 'secondary'}>
                        {alert.active ? 'Watching' : 'Paused'}
                      </Badge>
                      {alert.conditionValue !== null && (
                        <span>
                          Target <Price usd={alert.conditionValue} />
                        </span>
                      )}
                      {alert.triggerCount > 0 && <span>Triggered {alert.triggerCount}×</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Vector-matched recommendations */}
          <div className="glass-card p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-violet-600" /> Similar to your saved items
              <Badge variant="secondary">{data.summary.recommendationsCount}</Badge>
            </h3>
            {data.recommendations.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">
                {data.recommendationsNote ??
                  'No similar products found for your saved items yet.'}
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {data.recommendations.slice(0, 6).map((rec) => (
                  <li key={rec.id}>
                    <Link href={`/products/${rec.slug}`} className="block rounded-md p-1 transition-colors hover:bg-muted/50">
                      <span className="block truncate text-sm font-medium">{rec.name}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">
                          <Price usd={rec.lowestPriceUsd} />
                        </span>
                        <span>
                          {Math.round(rec.similarity * 100)}% similar to {rec.basedOnProductName}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
