'use client';

/**
 * Personalized deals feed (S3#18) — privacy-first picks for the homepage.
 *
 * Signals come ONLY from the visitor's own data:
 * - guest wishlist + guest price alerts (this device, localStorage)
 * - signed-in alerts (fetched only when the visitor is signed in)
 * Product categories/brands are resolved from the public product
 * catalog (one /api/v1/products call) — no browsing history is ever
 * collected, sent, or stored, and nothing is shared across users.
 *
 * The picks themselves come from the existing deal-finder endpoint
 * (POST /api/v1/deal-finder) with a query built from those signals
 * (see lib/personalized-feed.ts). With no signals the section shows
 * an honest empty state instead of generic deals — the homepage
 * already has the generic SmartDealWidget for that.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth';
import { getGuestWishlist } from '@/lib/guest-wishlist';
import { loadLocalAlerts } from '@/lib/local-alerts';
import {
  buildPersonalizedQuery,
  rankProductsBySignals,
  type PersonalizedSignal,
} from '@/lib/personalized-feed';

interface DealFinderProduct {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  imageUrl: string | null;
  price: number | null;
  category?: string | null;
}

interface CatalogProduct {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  category: string | null;
}

export function PersonalizedDeals() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);
  const [picks, setPicks] = useState<DealFinderProduct[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(false);
      try {
        // 1. Public catalog (one call) to resolve ids/slugs to
        //    names, categories and brands for the visitor's signals.
        const catalogById = new Map<string, CatalogProduct>();
        const catalogBySlug = new Map<string, CatalogProduct>();
        try {
          const res = await fetch('/api/v1/products?pageSize=100');
          const data: unknown = await res.json().catch(() => null);
          const products =
            data && typeof data === 'object' && 'data' in data
              ? (data as { data?: { products?: unknown[] } }).data?.products ?? []
              : [];
          for (const p of products) {
            if (p && typeof p === 'object') {
              const row = p as CatalogProduct;
              if (typeof row.id === 'string') catalogById.set(row.id, row);
              if (typeof row.slug === 'string') catalogBySlug.set(row.slug, row);
            }
          }
        } catch {
          // Catalog resolution is best-effort; name-only signals
          // below still work without it.
        }

        // 2. The visitor's own signals — guest first, signed-in
        //    alerts added when there is a session.
        const signals: PersonalizedSignal[] = [];
        const seen = new Set<string>();

        for (const item of getGuestWishlist()) {
          const resolved = catalogById.get(item.id) ?? catalogBySlug.get(item.slug);
          const key = `wishlist:${item.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          signals.push({
            kind: 'wishlist',
            productId: item.id,
            slug: resolved?.slug ?? item.slug,
            name: resolved?.name ?? item.name,
            category: resolved?.category ?? null,
            brand: resolved?.brand ?? null,
          });
        }

        for (const alert of loadLocalAlerts()) {
          const resolved = catalogById.get(alert.productId);
          const key = `alert:${alert.productId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          signals.push({
            kind: 'alert',
            productId: alert.productId,
            slug: resolved?.slug ?? null,
            name: resolved?.name ?? alert.productName,
            category: resolved?.category ?? null,
            brand: resolved?.brand ?? null,
            targetPrice: alert.targetPrice,
          });
        }

        if (user) {
          try {
            const res = await fetch('/api/v1/alerts');
            const data: unknown = await res.json().catch(() => null);
            const alerts =
              data && typeof data === 'object' && 'data' in data
                ? (data as { data?: unknown }).data
                : null;
            if (Array.isArray(alerts)) {
              for (const a of alerts) {
                if (!a || typeof a !== 'object') continue;
                const row = a as {
                  productId?: unknown;
                  alertType?: unknown;
                  conditionValue?: unknown;
                };
                if (typeof row.productId !== 'string') continue;
                const key = `alert:${row.productId}`;
                if (seen.has(key)) continue;
                seen.add(key);
                const resolved = catalogById.get(row.productId);
                signals.push({
                  kind: 'alert',
                  productId: row.productId,
                  slug: resolved?.slug ?? null,
                  name: resolved?.name ?? 'Saved product',
                  category: resolved?.category ?? null,
                  brand: resolved?.brand ?? null,
                  targetPrice:
                    typeof row.conditionValue === 'number'
                      ? row.conditionValue
                      : null,
                });
              }
            }
          } catch {
            // Signed-in alerts are additive — guest signals alone
            // are enough for a feed.
          }
        }

        const built = buildPersonalizedQuery(signals);
        if (cancelled) return;
        if (built.empty) {
          setEmpty(true);
          setLoading(false);
          return;
        }
        setReasons(built.reasons);

        // 3. Picks from the deal-finder endpoint, ranked by overlap
        //    with the visitor's own signals.
        const res = await fetch('/api/v1/deal-finder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: built.query }),
        });
        const data: unknown = await res.json().catch(() => null);
        const metadata =
          data && typeof data === 'object' && 'data' in data
            ? (data as { data?: { metadata?: { products?: unknown[] } } }).data?.metadata
            : null;
        const products = Array.isArray(metadata?.products)
          ? (metadata?.products as DealFinderProduct[]).filter(
              (p) => p && typeof p.slug === 'string'
            )
          : [];
        if (cancelled) return;
        if (products.length === 0) {
          setEmpty(true);
        } else {
          const ranked = rankProductsBySignals(
            products.map((p) => ({
              ...p,
              category: catalogById.get(p.id)?.category ?? null,
              brand: p.brand ?? catalogById.get(p.id)?.brand ?? null,
            })),
            signals
          );
          setPicks(ranked.slice(0, 6));
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm text-muted-foreground">Finding deals picked for you…</p>
      </div>
    );
  }

  if (empty) {
    return (
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="flex items-center justify-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
          <Sparkles className="h-6 w-6 text-amber-500" /> Deals picked for you
        </h2>
        <p className="mt-3 text-muted-foreground">
          No personal picks yet — save a product to your wishlist or set a price alert and
          your picks will appear here. Nothing is tracked: picks are built only from what
          you save on this device (and your alerts when signed in).
        </p>
        <Button className="mt-5" asChild>
          <Link href="/deals">Browse all deals</Link>
        </Button>
      </div>
    );
  }

  if (error || picks.length === 0) {
    return (
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="flex items-center justify-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
          <Sparkles className="h-6 w-6 text-amber-500" /> Deals picked for you
        </h2>
        <p className="mt-3 text-muted-foreground">
          Personal picks could not be loaded right now — please try again later, or browse
          all deals below.
        </p>
        <Button className="mt-5" variant="outline" asChild>
          <Link href="/deals">Browse all deals</Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="flex items-center justify-center gap-2 text-3xl font-bold tracking-tight md:text-4xl">
          <Sparkles className="h-6 w-6 text-amber-500" /> Deals picked for you
        </h2>
        <p className="mt-4 text-lg text-muted-foreground">
          Based on what you saved and alerted on — nothing else.
        </p>
        <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>
      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {picks.map((product) => (
          <Card key={product.id} className="transition-shadow hover:shadow-lg">
            <CardHeader>
              <CardTitle className="text-lg leading-tight">
                <Link href={`/products/${product.slug}`} className="hover:underline">
                  {product.name}
                </Link>
              </CardTitle>
              {product.brand && (
                <p className="text-sm text-muted-foreground">{product.brand}</p>
              )}
            </CardHeader>
            <CardContent>
              {product.price !== null && product.price !== undefined ? (
                <p className="text-2xl font-bold">${product.price.toFixed(2)}</p>
              ) : (
                <p className="text-sm text-muted-foreground">Price not listed</p>
              )}
              <Button size="sm" className="mt-4" asChild>
                <Link href={`/products/${product.slug}`}>View product</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
