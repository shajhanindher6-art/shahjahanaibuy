'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Plug } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Price } from '@/components/region/price';
import { gradeCompatibility, connectorNote, type GradedCandidate } from '@/services/compatibility';

/**
 * Battery & Accessory Compatibility Matrix (Option 10, Feature 5).
 * Candidates are REAL catalog products (similar-products endpoint) priced
 * via their real merchant listings. Grades follow the stated rules:
 * "Likely" (same brand + category) / "Possible" (same category) /
 * "Unknown" — "Exact" is NEVER assigned because no compatibility data
 * source exists. Connector notes come only from real spec fields; this
 * catalog records none, so the honest fallback is shown. No connector,
 * voltage, or wattage is ever invented, and no accessory is invented.
 */
interface SimilarProduct {
  slug: string;
  name: string;
  brand: string | null;
  category: string | null;
}

interface MerchantListing {
  price: number;
  availability?: string;
  inStock?: boolean;
}

export function CompatibilityMatrix({
  slug,
  productName,
  brand,
  category,
}: {
  slug: string;
  productName: string;
  brand: string | null;
  category: string | null;
}) {
  const [candidates, setCandidates] = useState<GradedCandidate[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/products/${slug}/similar?limit=8`);
      const data = await res.json();
      const sims: SimilarProduct[] = (data?.data ?? []) as SimilarProduct[];
      const graded: GradedCandidate[] = [];
      await Promise.all(
        sims.map(async (c) => {
          try {
            const mRes = await fetch(`/api/v1/products/${c.slug}/merchants`);
            const mData = await mRes.json();
            const listings: MerchantListing[] = (mData?.data ?? []) as MerchantListing[];
            const inStock = listings.filter(
              (l) => l.availability === 'in_stock' || l.inStock === true
            );
            const pool = inStock.length > 0 ? inStock : listings;
            const price = pool.length > 0 ? Math.min(...pool.map((l) => l.price)) : null;
            graded.push(gradeCompatibility({ brand, category }, { ...c, priceUsd: price }));
          } catch {
            // A candidate that cannot be priced is skipped, never guessed.
          }
        })
      );
      graded.sort((a, b) => {
        const order = { Likely: 0, Possible: 1, Unknown: 2 } as const;
        return order[a.grade] - order[b.grade];
      });
      setCandidates(graded.slice(0, 6));
    } catch {
      setCandidates([]);
    }
  }, [slug, brand, category]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plug className="h-5 w-5 text-sky-600" /> Battery & accessory compatibility
        </CardTitle>
        <CardDescription>
          Candidate accessories for {productName} from the real catalogue. No exact compatibility
          is claimed — no compatibility data source exists for these products.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{connectorNote(null)}</p>
        {candidates === null && (
          <p className="text-sm text-muted-foreground">Checking catalogue accessories…</p>
        )}
        {candidates !== null && candidates.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No candidate accessories found in the catalogue for this product.
          </p>
        )}
        {candidates !== null && candidates.length > 0 && (
          <ul className="space-y-2">
            {candidates.map((c) => (
              <li key={c.slug} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                <div>
                  <Link href={`/products/${c.slug}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {c.grade}: {c.gradeNote}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      c.grade === 'Likely' ? 'default' : c.grade === 'Possible' ? 'secondary' : 'outline'
                    }
                  >
                    {c.grade}
                  </Badge>
                  {c.priceUsd !== null && (
                    <span className="text-sm font-medium">
                      <Price usd={c.priceUsd} />
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Grades are a catalogue heuristic (brand + category), not a manufacturer compatibility
          statement. Verify connector and specs with the manufacturer before buying.
        </p>
      </CardContent>
    </Card>
  );
}
