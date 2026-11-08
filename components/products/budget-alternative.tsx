/**
 * Budget alternative card (Enterprise #12).
 *
 * Shown only when the product the shopper is viewing costs MORE
 * than their budget AND a real vector-matched alternative (cosine
 * similarity >= 0.95, real lowest price within budget) exists.
 * Renders nothing while loading, on error, when the product is
 * already within budget, or when no qualifying alternative exists
 * — an optional recommendation slot must never show a spinner, an
 * error banner, or a faked alternative.
 *
 * The similarity is shown as a percentage only because the
 * service guarantees >= 0.95 (services/alternative-recommender.ts
 * enforces the threshold server-side and the route never returns a
 * match below it). The component imports the type only — the
 * service module itself stays server-side (it pulls in the
 * Hugging Face helpers and env validation, which must never enter
 * the client bundle).
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, BadgePercent } from 'lucide-react';
import { Price } from '@/components/region/price';
import type { BudgetAlternative } from '@/services/alternative-recommender';

interface BudgetAlternativeResponse {
  success: boolean;
  data?: {
    alternative: BudgetAlternative | null;
    reason: string;
    sourceLowestPriceUsd: number | null;
    budgetUsd: number;
    note: string | null;
  };
}

export function BudgetAlternative({
  productSlug,
  budgetUsd,
  sourcePriceUsd,
}: {
  productSlug: string;
  budgetUsd: number;
  /** Real lowest recorded price of the viewed product, when known. */
  sourcePriceUsd: number | null;
}) {
  const [alternative, setAlternative] = useState<BudgetAlternative | null>(null);

  useEffect(() => {
    // Not over budget (or no budget / no price to compare) — the
    // slot stays empty. No request is spent.
    if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) return;
    if (sourcePriceUsd === null || sourcePriceUsd <= budgetUsd) return;
    let cancelled = false;
    fetch(
      `/api/v1/products/${encodeURIComponent(productSlug)}/budget-alternative?budget=${encodeURIComponent(budgetUsd)}`
    )
      .then((res) => (res.ok ? (res.json() as Promise<BudgetAlternativeResponse>) : null))
      .then((json) => {
        if (cancelled || !json?.success) return;
        const alt = json.data?.alternative ?? null;
        // The route enforces the 0.95 threshold server-side; only a
        // real match with a real price inside the budget is shown.
        if (alt && Number.isFinite(alt.lowestPriceUsd) && alt.lowestPriceUsd <= budgetUsd) {
          setAlternative(alt);
        }
      })
      .catch(() => {
        // Optional slot: failures stay silent, never an error banner.
      });
    return () => {
      cancelled = true;
    };
  }, [productSlug, budgetUsd, sourcePriceUsd]);

  if (!alternative) return null;

  return (
    <Link
      href={`/products/${alternative.slug}`}
      className="glass-card block p-4 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
    >
      <div className="flex items-center gap-2">
        <BadgePercent className="h-5 w-5 text-emerald-600" />
        <p className="text-sm font-semibold">Over budget? A close match within your budget</p>
      </div>
      <p className="mt-2 text-base font-medium">{alternative.name}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {alternative.brand ? `${alternative.brand} · ` : ''}
        {Math.round(alternative.similarity * 100)}% vector match
      </p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-lg font-bold text-emerald-600">
          <Price usd={alternative.lowestPriceUsd} />
        </span>
        <span className="flex items-center gap-1 text-sm font-medium text-blue-600">
          View alternative <ArrowRight className="h-4 w-4" />
        </span>
      </div>
    </Link>
  );
}
