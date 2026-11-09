'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { checkPriceInflation } from '@/services/inflation-check';
import { predictResaleValue } from '@/services/resale-predictor';
import {
  computeTotalOwnership,
  ownershipStorageKey,
} from '@/services/total-ownership';

export interface CompareValueProduct {
  slug: string;
  name: string;
  lowestPriceUsd: number | null;
  /** Recorded annual depreciation rate as a fraction (0–1, Option 19). */
  recordedAnnualRate?: number | null;
  /** Recorded mandatory accessories cost in USD (Option 19). */
  mandatoryAccessoriesCost?: number | null;
}

/** Lowest finite retailer price, or null when no priced retailer exists. */
export function lowestPrice(
  prices: Array<number | null | undefined>
): number | null {
  const valid = prices.filter(
    (p): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0
  );
  return valid.length === 0 ? null : Math.min(...valid);
}

export interface OwnershipExtras {
  accessoriesUsd: number;
  warrantyUsd: number;
  maintenanceUsd: number;
}

const ZERO_EXTRAS: OwnershipExtras = {
  accessoriesUsd: 0,
  warrantyUsd: 0,
  maintenanceUsd: 0,
};

/**
 * The shopper's own saved ownership extras for a product (written by the
 * product-page calculator under the same key). Absent/corrupt/unavailable
 * storage → all zeros, never a guessed cost, never throws.
 */
export function ownershipExtrasFor(slug: string): OwnershipExtras {
  try {
    if (typeof localStorage === 'undefined') return ZERO_EXTRAS;
    const raw = localStorage.getItem(ownershipStorageKey(slug));
    if (!raw) return ZERO_EXTRAS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return ZERO_EXTRAS;
    const record = parsed as Record<string, unknown>;
    const read = (value: unknown): number =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? value
        : 0;
    return {
      accessoriesUsd: read(record.accessories),
      warrantyUsd: read(record.warranty),
      maintenanceUsd: read(record.maintenance),
    };
  } catch {
    return ZERO_EXTRAS;
  }
}

type FakeTone = 'bad' | 'warn' | 'good' | 'muted';

type CellState =
  | { status: 'loading' }
  | { status: 'failed' }
  | {
      status: 'ready';
      ownershipTotalUsd: number | null;
      fakeLabel: string;
      fakeTone: FakeTone;
      resaleLabel: string;
    };

const FAKE_LABELS: Record<string, { label: string; tone: FakeTone }> = {
  fake_discount_pattern: { label: 'Fake discount pattern', tone: 'bad' },
  inflated: { label: 'Price inflated', tone: 'warn' },
  no_pattern: { label: 'No pattern', tone: 'good' },
  insufficient: { label: 'Not enough history', tone: 'muted' },
};

function fmtUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/**
 * Value checks side by side (batch 2): estimated total ownership cost
 * (base price + the shopper's own saved extras, 0 when none saved),
 * the fake-sale / inflation verdict, and the simulated 24-month resale
 * retention — all from each product's real recorded price history.
 * Every cell degrades honestly: loading → "…", fetch failure → "—",
 * too little history → "Not enough history". Nothing here invents a
 * price, a cost, or a resale quote.
 */
export function CompareValueChecks({
  products,
}: {
  products: CompareValueProduct[];
}) {
  const [cells, setCells] = useState<Record<string, CellState>>({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const next: Record<string, CellState> = {};
      await Promise.all(
        products.map(async (p) => {
          try {
            const res = await fetch(
              `/api/v1/products/${p.slug}/prices?limit=500`,
              { signal: AbortSignal.timeout(15000) }
            );
            if (!res.ok) throw new Error('prices request failed');
            const data = await res.json();
            const history = (data?.data?.history ?? []) as Array<{
              price: number;
              recordedAt: string;
            }>;
            const points = history
              .map((h) => ({
                price: Number(h.price),
                recordedAt: h.recordedAt,
              }))
              .filter((h) => Number.isFinite(h.price) && h.recordedAt);

            const fake = checkPriceInflation(points);
            const fakeMeta = FAKE_LABELS[fake.verdict] ?? {
              label: 'Not enough history',
              tone: 'muted' as const,
            };
            const resale = predictResaleValue(
              points,
              p.lowestPriceUsd,
              p.recordedAnnualRate ?? null
            );
            const extras = ownershipExtrasFor(p.slug);
            const ownership =
              p.lowestPriceUsd === null
                ? null
                : computeTotalOwnership({
                    basePriceUsd: p.lowestPriceUsd,
                    accessoriesUsd: extras.accessoriesUsd,
                    warrantyUsd: extras.warrantyUsd,
                    maintenanceUsd: extras.maintenanceUsd,
                    mandatoryAccessoriesUsd: p.mandatoryAccessoriesCost ?? 0,
                  }).totalUsd;
            next[p.slug] = {
              status: 'ready',
              ownershipTotalUsd: ownership,
              fakeLabel: fakeMeta.label,
              fakeTone: fakeMeta.tone,
              resaleLabel:
                resale.status === 'insufficient' ||
                resale.retentionPct24 === null
                  ? 'Not enough history'
                  : `${resale.retentionPct24}% kept (${fmtUsd(resale.projectedValueUsd24 ?? 0)} in 24 mo, simulated${resale.source === 'recorded' ? ' · recorded rate' : ''})`,
            };
          } catch {
            next[p.slug] = { status: 'failed' };
          }
        })
      );
      if (!cancelled) setCells(next);
    }
    setCells(
      Object.fromEntries(products.map((p) => [p.slug, { status: 'loading' as const }]))
    );
    load();
    return () => {
      cancelled = true;
    };
  }, [products]);

  if (products.length < 2) return null;

  const toneClass: Record<string, string> = {
    bad: 'text-red-600 font-semibold',
    warn: 'text-amber-600 font-semibold',
    good: 'text-green-600',
    muted: 'text-muted-foreground',
  };

  const cell = (slug: string): CellState =>
    cells[slug] ?? { status: 'loading' };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Value checks</CardTitle>
        <p className="text-sm text-muted-foreground">
          Estimated total cost, fake-discount check, and simulated resale —
          from each product&apos;s recorded prices. Resale is simulated, not a
          quote.
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 pr-4 font-medium">Check</th>
                {products.map((p) => (
                  <th key={p.slug} className="py-2 pr-4 font-medium">
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b align-top">
                <td className="py-2 pr-4 font-medium">
                  Estimated total cost
                </td>
                {products.map((p) => {
                  const c = cell(p.slug);
                  return (
                    <td key={p.slug} className="py-2 pr-4">
                      {c.status === 'loading'
                        ? '…'
                        : c.status === 'failed'
                          ? '—'
                          : c.ownershipTotalUsd === null
                            ? 'No recorded price'
                            : fmtUsd(c.ownershipTotalUsd)}
                    </td>
                  );
                })}
              </tr>
              <tr className="border-b align-top">
                <td className="py-2 pr-4 font-medium">Fake-sale check</td>
                {products.map((p) => {
                  const c = cell(p.slug);
                  return (
                    <td key={p.slug} className="py-2 pr-4">
                      {c.status === 'loading' ? (
                        '…'
                      ) : c.status === 'failed' ? (
                        '—'
                      ) : (
                        <span className={toneClass[c.fakeTone]}>
                          {c.fakeLabel}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
              <tr className="align-top">
                <td className="py-2 pr-4 font-medium">
                  Resale in 24 months
                </td>
                {products.map((p) => {
                  const c = cell(p.slug);
                  return (
                    <td key={p.slug} className="py-2 pr-4">
                      {c.status === 'loading'
                        ? '…'
                        : c.status === 'failed'
                          ? '—'
                          : c.resaleLabel}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
