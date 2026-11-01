'use client';

import { useEffect, useState } from 'react';

/**
 * Homepage stats bar — real counts, not marketing claims.
 *
 * The old bar claimed "10M+ products / 500+ retailers / 99.9%
 * uptime / <200ms response", none of which was measured or true
 * for a ~10-product catalog. This bar fetches the public APIs
 * (products, merchants, ranked deals, coupons) and shows their
 * actual totals. While loading, stats show a dash; if an API
 * fails, that stat is hidden rather than replaced with a guess.
 */
export function StatsBar() {
  const [stats, setStats] = useState<Array<{ value: string; label: string }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fetchTotal = async (url: string): Promise<number | null> => {
        try {
          const res = await fetch(url);
          const data = await res.json();
          if (!data.success) return null;
          // products/merchants/coupons: meta.total. Ranked deals:
          // data.data.total from the ranked-deals payload.
          if (typeof data.meta?.total === 'number') return data.meta.total;
          if (typeof data.data?.total === 'number') return data.data.total;
          if (Array.isArray(data.data)) return data.data.length;
          return null;
        } catch {
          return null;
        }
      };
      const [products, retailers, deals, coupons] = await Promise.all([
        fetchTotal('/api/v1/products?pageSize=1'),
        fetchTotal('/api/v1/merchants?pageSize=1'),
        fetchTotal('/api/v1/deals/ranked?limit=1'),
        fetchTotal('/api/v1/coupons?pageSize=1'),
      ]);
      if (cancelled) return;
      const items: Array<{ value: string; label: string }> = [];
      if (products !== null) items.push({ value: String(products), label: 'Products in Catalog' });
      if (retailers !== null) items.push({ value: String(retailers), label: 'Retailers' });
      if (deals !== null) items.push({ value: String(deals), label: 'Ranked Deals' });
      if (coupons !== null) items.push({ value: String(coupons), label: 'Active Coupons' });
      setStats(items);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (stats === null || stats.length === 0) return null;

  return (
    <section className="border-y bg-muted/30">
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-3xl font-bold text-primary md:text-4xl">{stat.value}</div>
              <div className="mt-1 text-sm text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
