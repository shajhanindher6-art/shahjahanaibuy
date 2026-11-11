/**
 * "Complete your setup" affinity section (Section 14, Chunk 2, B12).
 *
 * A labelled suggestion row on product pages — "Pairs well with",
 * NOT "frequently bought together" (no purchase / co-occurrence
 * data exists). Picks come from the static category-affinity map
 * in lib/setup-affinity.ts, priced from each candidate's cheapest
 * merchant listing. Renders nothing when no priced affinity pick
 * exists, and never blocks the page: every fetch failure leaves
 * the section hidden instead of erroring.
 *
 * Price source: GET /api/v1/products/[slug]/merchants returns
 * listings cheapest first, so listings[0].price is the candidate's
 * verified cheapest price. A candidate with no listing (or a
 * failed fetch) is unpriced and dropped by getSetupAffinity.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { getSetupAffinity, type AffinityCandidate, type AffinityPick } from '@/lib/setup-affinity';

interface SetupAffinitySectionProps {
  productId: string;
  productSlug: string;
  category: string | null;
}

interface CatalogRow {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  category: string | null;
}

export function SetupAffinitySection({ productId, productSlug, category }: SetupAffinitySectionProps) {
  const [picks, setPicks] = useState<AffinityPick[] | null>(null);

  useEffect(() => {
    if (!category) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/v1/products?pageSize=100', {
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) return;
        const json = await res.json().catch(() => null);
        const list = Array.isArray(json?.data)
          ? json.data
          : (json?.data?.products ?? []);
        const rows = (list as CatalogRow[]).filter(
          (p) => p && typeof p.id === 'string' && p.id !== productId && p.slug !== productSlug
        );
        if (rows.length === 0) return;
        // Cheapest merchant price per candidate (one small call
        // each; the catalog is 10 products, so this stays cheap).
        // A failed fetch leaves that candidate unpriced — it is
        // then dropped, never shown with a guessed price.
        const candidates: AffinityCandidate[] = await Promise.all(
          rows.map(async (p) => {
            try {
              const mRes = await fetch(
                `/api/v1/products/${encodeURIComponent(p.slug)}/merchants`,
                { signal: AbortSignal.timeout(15000) }
              );
              if (!mRes.ok) return { ...p, price: null };
              const mJson = await mRes.json().catch(() => null);
              const listings = Array.isArray(mJson?.data) ? mJson.data : [];
              const price =
                listings.length > 0 && typeof listings[0].price === 'number'
                  ? (listings[0].price as number)
                  : null;
              return { ...p, price };
            } catch {
              return { ...p, price: null };
            }
          })
        );
        if (!cancelled) setPicks(getSetupAffinity(category, productId, candidates, 3));
      } catch {
        // Section stays hidden on failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId, productSlug, category]);

  if (!picks || picks.length === 0) return null;

  return (
    <section aria-label="Complete your setup">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Complete your setup</CardTitle>
          <CardDescription>
            Pairs well with — suggestions based on category, not
            purchase data.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            {picks.map((p) => (
              <Link
                key={p.slug}
                href={`/products/${p.slug}`}
                className="rounded-lg border p-3 transition-colors hover:border-blue-300 hover:bg-blue-50/50 dark:hover:border-blue-700 dark:hover:bg-blue-950/50"
              >
                <p className="text-sm font-semibold">{p.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {p.brand ?? 'Unknown brand'} · {p.affinityCategory}
                </p>
                <p className="mt-1 text-base font-bold">
                  ${(p.price as number).toFixed(2)}
                </p>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
