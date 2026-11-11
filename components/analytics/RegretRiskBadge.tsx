'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  computeRegretRisk,
  specOverkillPoints,
  type NeedsLevel,
  type SpecTier,
} from '@/lib/analytics/regretRisk';
import { cn } from '@/lib/utils';

/**
 * Impulse-Buy Regret Risk Badge (Option 16, Step 3).
 *
 * Interactive budget slider + needs selector over the deterministic
 * Regret Risk formula. The score is pure math from the product's real
 * recorded price, the slider's monthly tech budget, and spec overkill
 * derived from RECORDED specs vs the shopper's stated needs — never
 * from an invented spec. When no specs are recorded, overkill is 0
 * and the card says so plainly.
 *
 * No price → honest "cannot be calculated" state, never a fake score.
 */

const NEEDS_OPTIONS: Array<{ value: NeedsLevel; label: string }> = [
  { value: 'basic', label: 'Basic — browsing, email, documents' },
  { value: 'balanced', label: 'Balanced — work, study, everyday apps' },
  { value: 'pro', label: 'Pro — editing, rendering, heavy workloads' },
];

const CATEGORY_STYLE: Record<string, string> = {
  low: 'bg-emerald-500',
  moderate: 'bg-amber-500',
  high: 'bg-red-500',
};

const CATEGORY_TEXT: Record<string, string> = {
  low: 'text-emerald-700',
  moderate: 'text-amber-700',
  high: 'text-red-700',
};

export function RegretRiskBadge({
  priceUsd,
  initialMonthlyBudgetUsd,
  specTier,
  specsRecorded,
}: {
  priceUsd: number | null;
  initialMonthlyBudgetUsd?: number | null;
  specTier: SpecTier | null;
  specsRecorded: boolean;
}) {
  const [budget, setBudget] = useState<number>(
    initialMonthlyBudgetUsd && initialMonthlyBudgetUsd > 0
      ? Math.round(initialMonthlyBudgetUsd)
      : 1000
  );
  const [needs, setNeeds] = useState<NeedsLevel>('balanced');

  const result = useMemo(() => {
    const overkill = specOverkillPoints({ needsLevel: needs, specTier });
    return computeRegretRisk({
      priceUsd,
      monthlyBudgetUsd: budget,
      specOverkillPoints: overkill ?? 0,
      overkillUnassessed: !specsRecorded,
    });
  }, [priceUsd, budget, needs, specTier, specsRecorded]);

  if (priceUsd === null || priceUsd === undefined || !Number.isFinite(priceUsd) || priceUsd <= 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Regret Risk</CardTitle>
          <CardDescription>Impulse-buy check — price vs your tech budget</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No recorded price for this product, so regret risk can&apos;t be calculated.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Regret Risk</CardTitle>
        <CardDescription>
          Impulse-buy check — price vs your monthly tech budget
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label htmlFor="regret-budget" className="text-sm font-medium">
            Monthly tech budget: ${budget.toLocaleString()}
          </label>
          <input
            id="regret-budget"
            type="range"
            min={100}
            max={5000}
            step={50}
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
            className="mt-2 w-full accent-blue-600"
            aria-label="Monthly tech budget in US dollars"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>$100</span>
            <span>$5,000</span>
          </div>
        </div>

        <div>
          <label htmlFor="regret-needs" className="text-sm font-medium">
            What do you need it for?
          </label>
          <select
            id="regret-needs"
            value={needs}
            onChange={(e) => setNeeds(e.target.value as NeedsLevel)}
            className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            {NEEDS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {result ? (
          <>
            <div>
              <div className="flex items-center justify-between">
                <span className={cn('text-2xl font-bold', CATEGORY_TEXT[result.category])}>
                  {result.score}/100
                </span>
                <Badge
                  className={cn(
                    'text-white',
                    result.category === 'low' && 'bg-emerald-600',
                    result.category === 'moderate' && 'bg-amber-600',
                    result.category === 'high' && 'bg-red-600'
                  )}
                >
                  {result.label}
                </Badge>
              </div>
              <div
                className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={result.score}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Regret risk score ${result.score} out of 100`}
              >
                <div
                  className={cn('h-full rounded-full', CATEGORY_STYLE[result.category])}
                  style={{ width: `${result.score}%` }}
                />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{result.advice}</p>
            <p className="text-xs text-muted-foreground">
              Price is {result.priceToBudgetRatio.toFixed(1)}× your monthly budget.
              {!specsRecorded &&
                ' Spec overkill not assessed — no specs recorded for this product.'}
            </p>
          </>
        ) : (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            Regret risk can&apos;t be calculated with this budget — set a monthly budget above $0.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
