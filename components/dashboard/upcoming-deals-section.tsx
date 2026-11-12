/**
 * Upcoming Deals section — AI Glass dashboard.
 *
 * Deals scheduled to start in the future (GET /api/v1/deals
 * ?status=upcoming), joined to product names/slugs via the public
 * products list. The "Starts in Xd" label comes only from the
 * deal's real start_at.
 *
 * HONEST EMPTY STATE: there are no scheduled upcoming deals today
 * (all seed deals started in the past), so this section says so
 * plainly instead of inventing future deals. It fills in the moment
 * the owner or the community adds a future-dated deal.
 */

'use client';

import { useRegion } from '@/components/region/region-provider';
import { tFor } from '@/lib/i18n';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { CalendarClock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatDealStartsIn } from '@/services/dashboard-helpers';

interface UpcomingDeal {
  id: string;
  productId: string;
  title: string;
  discountValue: number;
  startAt: string;
  endAt: string;
}

interface ProductRow {
  id: string;
  name: string;
  slug: string;
}

export function UpcomingDealsSection() {
  const { language } = useRegion();
  const [deals, setDeals] = useState<UpcomingDeal[]>([]);
  const [productById, setProductById] = useState<Map<string, ProductRow>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [dealsRes, productsRes] = await Promise.all([
          fetch('/api/v1/deals?status=upcoming&pageSize=6').catch(() => null),
          fetch('/api/v1/products?pageSize=100').catch(() => null),
        ]);
        if (cancelled) return;
        if (dealsRes && dealsRes.ok) {
          const data = await dealsRes.json();
          if (data.success) setDeals(data.data ?? []);
        }
        if (productsRes && productsRes.ok) {
          const data = await productsRes.json();
          const map = new Map<string, ProductRow>();
          for (const p of (data.data ?? []) as ProductRow[]) {
            if (p.id) map.set(p.id, p);
          }
          setProductById(map);
        }
      } catch {
        // Empty state below.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="animate-fade-in motion-reduce:animate-none" style={{ animationDelay: '200ms' }}>
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
        <CalendarClock className="h-5 w-5 text-violet-600" /> Upcoming deals
      </h2>
      {loading ? (
        <div className="glass-card animate-shimmer h-32" />
      ) : deals.length === 0 ? (
        <div className="glass-card p-6 text-center">
          <p className="text-sm font-medium">{tFor(language, 'dashNoUpcomingDeals')}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Future-dated deals will appear here as soon as they are scheduled.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {deals.map((deal) => {
            const product = productById.get(deal.productId);
            const inner = (
              <>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{product?.name ?? deal.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{deal.title}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge>{Math.round(deal.discountValue)}% off</Badge>
                  <Badge variant="secondary">{formatDealStartsIn(deal.startAt)}</Badge>
                </div>
              </>
            );
            return product ? (
              <Link
                key={deal.id}
                href={`/products/${product.slug}`}
                className="glass-card flex items-center justify-between gap-3 p-3 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg"
              >
                {inner}
              </Link>
            ) : (
              <div key={deal.id} className="glass-card flex items-center justify-between gap-3 p-3">
                {inner}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
