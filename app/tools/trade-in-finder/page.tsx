/**
 * AI Trade-in & Second-hand Finder — /tools/trade-in (Section 7 item 8).
 *
 * Real trade-in program directory (starts EMPTY — no program is
 * ever invented) + the Resale Predictor for the user's own product
 * ("tumhara purana $X ka hai"), labeled "Simulated — not a resale
 * quote". No refurbished listings are invented: there is no
 * recorded refurbished inventory.
 */

'use client';

import { useRegion } from '@/components/region/region-provider';
import { tFor } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Recycle } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';

interface TradeInProgram {
  id: string;
  name: string;
  retailer: string | null;
  url: string | null;
  category: string | null;
  notes: string | null;
  isVerified: boolean;
}

interface Resale {
  status: 'ok' | 'insufficient';
  retentionPct24: number | null;
  projectedValueUsd24: number | null;
  reason: string;
  source: 'recorded' | 'derived';
}

interface ProductOption {
  slug: string;
  name: string;
}

interface TradeInData {
  programs: TradeInProgram[];
  directoryAvailable: boolean;
  totalPrograms: number;
  verifiedPrograms: number;
  emptyMessage: string | null;
  product: { slug: string; name: string } | null;
  resale: Resale | null;
  headline: string;
  refurbishedNote: string;
}

export default function TradeInPage() {
  const { language } = useRegion();
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [slug, setSlug] = useState('');
  const [data, setData] = useState<TradeInData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadProducts() {
      try {
        const res = await fetch('/api/v1/products?page=1&pageSize=100');
        if (!res.ok) return;
        const json = await res.json();
        const list = (json?.data?.products ?? []) as ProductOption[];
        if (!cancelled) setProducts(list);
      } catch {
        // Picker stays empty; the directory still loads below.
      }
    }
    loadProducts();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const url = slug ? `/api/v1/tools/trade-in?slug=${encodeURIComponent(slug)}` : '/api/v1/tools/trade-in';
        const res = await fetch(url);
        if (!res.ok) throw new Error('load failed');
        const json = await res.json();
        if (!cancelled) setData(json.data as TradeInData);
      } catch {
        if (!cancelled) setError('Could not load the trade-in finder. Please try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Recycle className="h-7 w-7 text-emerald-600" /> {tFor(language, 'toolHeadingTradeInFinder')}
          </h1>
          <p className="mt-2 text-muted-foreground">
            Before buying new, see what your old product is worth and
            where you can trade it in. Trade-in programs are listed
            only when a real program is confirmed — none are invented.
            Values and programs come from recorded data with
            deterministic rules — no LLM, nothing guessed.
          </p>

          <div className="mt-8">
            <label htmlFor="trade-in-product" className="text-sm font-medium">
              Your current product (optional)
            </label>
            <select
              id="trade-in-product"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="">No product selected</option>
              {products.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {loading ? (
            <p className="mt-8 text-muted-foreground">Loading…</p>
          ) : error ? (
            <p role="alert" className="mt-8 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              {error}
            </p>
          ) : data ? (
            <>
              <div className="mt-8 rounded-lg border p-6">
                <h2 className="text-xl font-semibold">What your old product is worth</h2>
                <p className="mt-2 text-sm">{data.headline}</p>
                {data.resale && data.resale.status === 'ok' && data.resale.projectedValueUsd24 !== null ? (
                  <p className="mt-2 text-2xl font-bold text-emerald-600">
                    ${data.resale.projectedValueUsd24.toFixed(2)}
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      after 24 months ({data.resale.retentionPct24}% retained)
                    </span>
                  </p>
                ) : null}
                {data.resale ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Simulated — not a resale quote or guarantee. {data.resale.reason}
                  </p>
                ) : null}
                {data.product ? (
                  <p className="mt-3 text-sm">
                    <Link href={`/products/${data.product.slug}`} className="underline">
                      View {data.product.name} →
                    </Link>
                  </p>
                ) : null}
              </div>

              <div className="mt-6 rounded-lg border p-6">
                <h2 className="text-xl font-semibold">Trade-in programs</h2>
                {data.totalPrograms === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">{data.emptyMessage}</p>
                ) : (
                  <>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {data.verifiedPrograms} of {data.totalPrograms} verified.
                    </p>
                    <ul className="mt-3 space-y-3">
                      {data.programs.map((p) => (
                        <li key={p.id} className="text-sm">
                          <span className="font-medium">{p.name}</span>
                          {p.retailer ? <span className="text-muted-foreground"> · {p.retailer}</span> : null}
                          {p.isVerified ? (
                            <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                              Verified
                            </span>
                          ) : null}
                          {p.category ? (
                            <span className="text-muted-foreground"> · {p.category}</span>
                          ) : null}
                          {p.notes ? <p className="mt-1 text-muted-foreground">{p.notes}</p> : null}
                          {p.url ? (
                            <a href={p.url} target="_blank" rel="noopener noreferrer" className="underline">
                              Visit program →
                            </a>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>

              <div className="mt-6 rounded-lg border p-6">
                <h2 className="text-xl font-semibold">Certified refurbished</h2>
                <p className="mt-2 text-sm text-muted-foreground">{data.refurbishedNote}</p>
              </div>
            </>
          ) : null}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
