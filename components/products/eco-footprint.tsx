'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Leaf } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { estimateFootprint, bandLabel, type EcoBand } from '@/services/eco-footprint';
import {
  recordedBandLabel,
  sustainabilityFromRecorded,
} from '@/services/hardware-endurance';

interface SimilarProduct {
  slug: string;
  name: string;
  category: string | null;
}

interface MerchantListing {
  price: number;
  availability?: string;
  inStock?: boolean;
}

interface Alternative {
  slug: string;
  name: string;
  priceUsd: number;
  kgCO2e: number;
  band: EcoBand;
}

const BAND_STYLES: Record<EcoBand, string> = {
  'A+': 'bg-green-100 text-green-800',
  A: 'bg-green-100 text-green-800',
  B: 'bg-lime-100 text-lime-800',
  C: 'bg-yellow-100 text-yellow-800',
  D: 'bg-orange-100 text-orange-800',
  E: 'bg-red-100 text-red-800',
};

/**
 * Eco-footprint module (Option 8, Feature 1). Figures are ESTIMATES
 * from services/eco-footprint.ts (category baseline × price proxy) — never
 * a certification, never measured data — UNLESS a recorded carbon
 * footprint exists (Option 17, `recordedCarbonKg`): recorded data
 * supersedes the estimate, so the module then shows the RECORDED value
 * (same A+–E thresholds, "recorded" wording) and never the estimate
 * number. One product, one carbon number — the two are never mixed.
 * Alternatives are REAL catalog products with a lower estimate; when
 * none exist the UI says so. Alternatives are estimate-ranked, so they
 * are hidden while a recorded footprint is shown.
 */
export function EcoFootprint({
  slug,
  category,
  cheapestPriceUsd,
  recordedCarbonKg,
}: {
  slug: string;
  category: string | null;
  cheapestPriceUsd: number | null;
  /** Recorded carbon_footprint_kg (Option 17) — null when not recorded. */
  recordedCarbonKg?: number | null;
}) {
  const [alternatives, setAlternatives] = useState<Alternative[] | null>(null);

  const recorded = sustainabilityFromRecorded({
    carbonFootprintKg: recordedCarbonKg ?? null,
    category,
  });
  // Non-null only when a real recorded value exists; otherwise the
  // module falls back to the estimate exactly as before.
  const recordedKg = recorded.status === 'recorded' ? recorded.kgCO2e : null;
  const estimate = recordedKg !== null ? null : estimateFootprint(category, cheapestPriceUsd);

  const loadAlternatives = useCallback(async () => {
    if (!estimate) return;
    try {
      const res = await fetch(`/api/v1/products/${slug}/similar?limit=8`);
      const data = await res.json();
      const candidates: SimilarProduct[] = (data?.data ?? []) as SimilarProduct[];
      const priced: Alternative[] = [];
      await Promise.all(
        candidates.map(async (c) => {
          try {
            const mRes = await fetch(`/api/v1/products/${c.slug}/merchants`);
            const mData = await mRes.json();
            const listings: MerchantListing[] = (mData?.data ?? []) as MerchantListing[];
            const inStock = listings.filter(
              (l) => l.availability === 'in_stock' || l.inStock === true
            );
            const pool = inStock.length > 0 ? inStock : listings;
            if (pool.length === 0) return;
            const cheapest = Math.min(...pool.map((l) => l.price));
            const est = estimateFootprint(c.category, cheapest);
            if (est && est.kgCO2e < estimate.kgCO2e) {
              priced.push({ slug: c.slug, name: c.name, priceUsd: cheapest, kgCO2e: est.kgCO2e, band: est.band });
            }
          } catch {
            // A candidate that cannot be priced is skipped, never guessed.
          }
        })
      );
      priced.sort((a, b) => a.kgCO2e - b.kgCO2e);
      setAlternatives(priced.slice(0, 3));
    } catch {
      setAlternatives([]);
    }
  }, [slug, estimate]);

  useEffect(() => {
    loadAlternatives();
  }, [loadAlternatives]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Leaf className="h-5 w-5 text-green-600" /> Eco footprint
          {recordedKg !== null ? ' (recorded)' : ' (estimated)'}
        </CardTitle>
        <CardDescription>
          {recordedKg !== null
            ? 'Recorded carbon footprint — recorded data supersedes the category estimate, so no estimate is shown here. Recorded data only — not a certified lifecycle assessment.'
            : 'Estimate only — not a certified lifecycle assessment. Computed from a category baseline adjusted by price (see services/eco-footprint.ts); it is a catalogue comparison aid, not a scientific measurement.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {recordedKg !== null ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-2xl font-bold">{recordedKg} kg CO₂e</span>
              {recorded.band && (
                <Badge className={BAND_STYLES[recorded.band]}>Sustainability {recorded.band}</Badge>
              )}
            </div>
            {recorded.band && (
              <p className="text-sm text-muted-foreground">{recordedBandLabel(recorded.band)}.</p>
            )}
            {recorded.categoryBaseKg !== null ? (
              <p className="text-sm text-muted-foreground">
                Recorded footprint vs a {recorded.categoryBaseKg} kg category baseline (ratio{' '}
                {recorded.ratio?.toFixed(2)}). Recorded data only — not a certified lifecycle
                assessment.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Recorded footprint — no category baseline exists to rank it against. Recorded data
                only — not a certified lifecycle assessment.
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Eco-friendly alternatives are ranked by estimate, so they are not listed next to a
              recorded footprint.
            </p>
          </>
        ) : !estimate ? (
          <p className="text-sm text-muted-foreground">
            Cannot estimate a carbon footprint for this product — its category is unknown or it has
            no priced listing to base the estimate on.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-2xl font-bold">{estimate.kgCO2e} kg CO₂e</span>
              <Badge className={BAND_STYLES[estimate.band]}>Sustainability {estimate.band}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {bandLabel(estimate.band)}. Category baseline {estimate.categoryBaseKg} kg CO₂e × price
              factor {estimate.priceFactor}.
            </p>
            <div>
              <p className="mb-2 text-sm font-semibold">Eco-friendly alternatives (lower estimate)</p>
              {alternatives === null ? (
                <p className="text-sm text-muted-foreground">Checking catalogue products…</p>
              ) : alternatives.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No lower-footprint alternative found in the catalogue for this category.
                </p>
              ) : (
                <ul className="space-y-2">
                  {alternatives.map((a) => (
                    <li key={a.slug} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <Link href={`/products/${a.slug}`} className="min-w-0 flex-1 break-words text-primary hover:underline">
                        {a.name}
                      </Link>
                      <span className="shrink-0 text-muted-foreground">
                        ${a.priceUsd.toFixed(2)} · {a.kgCO2e} kg CO₂e · {a.band}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
