'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { evaluateBuyingOpportunity } from '@/services/buying-opportunity';

/**
 * Buying-opportunity badge (Section 19, Phase 2 §12 #25).
 *
 * Renders ONLY when all four conditions hold — at/near the
 * recorded low + fresh price + validated discount + in stock
 * (see services/buying-opportunity.ts). Any missing condition
 * renders NOTHING: no weaker badge, no partial signal. Loading
 * or a failed history fetch also renders nothing — a badge must
 * never appear on unevaluated evidence.
 *
 * History comes from the same prices endpoint the price-history
 * graph and the trust check already use
 * (/api/v1/products/[slug]/prices); no new API route.
 */
export function BuyingOpportunityBadge({
  slug,
  currentPrice,
  lowestPrice,
  dataFreshness,
  inStock,
}: {
  slug: string;
  currentPrice: number | null;
  lowestPrice: number | null;
  dataFreshness: string | null;
  inStock: boolean;
}) {
  const [qualified, setQualified] = useState(false);
  const [evidence, setEvidence] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/v1/products/${slug}/prices?limit=100`, {
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) return;
        const json = await res.json();
        const history = ((json?.data?.history ?? []) as Array<{
          price: number | string;
          recordedAt: string;
        }>)
          .filter((p) => Number.isFinite(Number(p.price)) && Number(p.price) > 0)
          .map((p) => ({ price: Number(p.price), recordedAt: p.recordedAt }));
        const result = evaluateBuyingOpportunity({
          currentPrice,
          lowestPrice,
          dataFreshness,
          history,
          inStock,
        });
        if (!cancelled && result.qualifies) {
          setQualified(true);
          setEvidence(result.evidence);
        }
      } catch {
        // History unavailable: no badge, never a badge on no evidence.
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [slug, currentPrice, lowestPrice, dataFreshness, inStock]);

  if (!qualified) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950"
      title={evidence ?? undefined}
    >
      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Buying opportunity</Badge>
      <p className="text-sm text-emerald-900 dark:text-emerald-100">{evidence}</p>
    </div>
  );
}
