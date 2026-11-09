'use client';

import { useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  computeTotalOwnership,
  ownershipStorageKey,
  type OwnershipResult,
} from '@/services/total-ownership';

interface SavedOwnershipInputs {
  accessories: number;
  warranty: number;
  maintenance: number;
}

const EMPTY_INPUTS: SavedOwnershipInputs = {
  accessories: 0,
  warranty: 0,
  maintenance: 0,
};

function parseSaved(raw: string | null): SavedOwnershipInputs {
  if (!raw) return EMPTY_INPUTS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_INPUTS;
    const read = (value: unknown): number =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? value
        : 0;
    const record = parsed as Record<string, unknown>;
    return {
      accessories: read(record.accessories),
      warranty: read(record.warranty),
      maintenance: read(record.maintenance),
    };
  } catch {
    return EMPTY_INPUTS;
  }
}

function fmtUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function fmtInput(value: number): string {
  return value > 0 ? String(value) : '';
}

/**
 * Hidden Costs & Total Ownership Calculator.
 *
 * Base price is the product's REAL recorded lowest merchant price
 * (passed in by the page — never fetched or guessed here). The three
 * extra amounts are the shopper's OWN estimates, entered by hand and
 * defaulting to 0; nothing is pre-filled with a guessed cost. The
 * inputs persist per product in localStorage so the shopper does not
 * have to re-enter them, and the breakdown always says these are
 * estimates — never a checkout total or a quote.
 *
 * Renders an honest note (and no totals) when there is no recorded
 * base price for the product.
 */
export function TotalOwnershipCalculator({
  slug,
  productName,
  basePriceUsd,
}: {
  slug: string;
  productName: string;
  /** Cheapest recorded merchant price in USD, or null when unpriced. */
  basePriceUsd: number | null;
}) {
  const [inputs, setInputs] = useState<SavedOwnershipInputs>(EMPTY_INPUTS);
  const [loaded, setLoaded] = useState(false);

  const storageKey = ownershipStorageKey(slug);

  useEffect(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        setInputs(parseSaved(localStorage.getItem(storageKey)));
      }
    } catch {
      // Storage unavailable (SSR / private mode): keep the 0 defaults.
    } finally {
      setLoaded(true);
    }
    // The key is derived from the slug prop; reload when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const persist = (next: SavedOwnershipInputs) => {
    setInputs(next);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(storageKey, JSON.stringify(next));
      }
    } catch {
      // Storage unavailable: the in-memory values still work.
    }
  };

  const updateField = (field: keyof SavedOwnershipInputs, raw: string) => {
    const parsed = parseFloat(raw);
    const value =
      raw.trim() === '' || !Number.isFinite(parsed) || parsed < 0
        ? 0
        : parsed;
    persist({ ...inputs, [field]: value });
  };

  const handleReset = () => {
    persist(EMPTY_INPUTS);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(storageKey);
      }
    } catch {
      // Nothing to clean up when storage is unavailable.
    }
  };

  const hasBasePrice =
    typeof basePriceUsd === 'number' &&
    Number.isFinite(basePriceUsd) &&
    basePriceUsd > 0;

  const result: OwnershipResult | null = hasBasePrice
    ? computeTotalOwnership({
        basePriceUsd: basePriceUsd as number,
        accessoriesUsd: inputs.accessories,
        warrantyUsd: inputs.warranty,
        maintenanceUsd: inputs.maintenance,
      })
    : null;

  const fields: {
    field: keyof SavedOwnershipInputs;
    label: string;
    hint: string;
  }[] = [
    {
      field: 'accessories',
      label: 'Accessories (your estimate)',
      hint: 'Cases, chargers, adapters — whatever you plan to buy with it.',
    },
    {
      field: 'warranty',
      label: 'Protection plan / warranty (your estimate)',
      hint: 'Extended warranty or accident cover, if you plan to buy one.',
    },
    {
      field: 'maintenance',
      label: 'Maintenance budget (your estimate)',
      hint: 'Repairs, servicing or consumables over the time you keep it.',
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-emerald-600" />
          Total Cost of Ownership
        </CardTitle>
        <CardDescription>
          Base price plus your own estimates for accessories, protection
          and maintenance — a budget-planning total, not a checkout
          total or a quote.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasBasePrice ? (
          <p className="text-sm text-muted-foreground">
            No recorded price for {productName} — totals can&apos;t be
            calculated.
          </p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              {fields.map(({ field, label, hint }) => (
                <div key={field}>
                  <Label className="mb-1.5 block text-sm" htmlFor={`ownership-${field}`}>
                    {label}
                  </Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      $
                    </span>
                    <Input
                      id={`ownership-${field}`}
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={loaded ? fmtInput(inputs[field]) : ''}
                      onChange={(e) => updateField(field, e.target.value)}
                      placeholder="0.00"
                      className="pl-7"
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
                </div>
              ))}
            </div>

            {result && (
              <div className="space-y-1.5 rounded-lg border p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Base price</span>
                  <span className="font-medium">{fmtUsd(result.basePriceUsd)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Accessories</span>
                  <span className="font-medium">{fmtUsd(result.accessoriesUsd)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Protection plan / warranty</span>
                  <span className="font-medium">{fmtUsd(result.warrantyUsd)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Maintenance</span>
                  <span className="font-medium">{fmtUsd(result.maintenanceUsd)}</span>
                </div>
                <div className="flex justify-between border-t pt-1.5 font-bold">
                  <span>Estimated total</span>
                  <span>{fmtUsd(result.totalUsd)}</span>
                </div>
                <p className="pt-1 text-xs text-muted-foreground">
                  Hidden costs (accessories + protection + maintenance) are{' '}
                  {result.extrasSharePct}% of the estimated total
                  {result.extrasUsd === 0 &&
                    ' — add your own estimates above to see them here'}
                  . All extra amounts are your estimates, saved on this
                  device only.
                </p>
              </div>
            )}

            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={handleReset}>
                Reset my estimates
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
