'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { Price } from '@/components/region/price';
import { cn } from '@/lib/utils';
import { fetchTimed } from '@/lib/fetch-timed';
import {
  buildMatrixRows,
  type MatrixCell,
  type MatrixProductInput,
  type PriceHistoryPoint,
} from '@/services/decision-matrix';
import type { DealCoupon } from '@/lib/deal-math';

/**
 * A product as the Decision Matrix consumes it — structurally the
 * same shape the compare page already holds (extra fields on the
 * caller's objects are fine; only these fields are read).
 */
export interface DecisionMatrixProduct {
  productId: string;
  slug: string;
  name: string;
  brand: string | null;
  retailers: Array<{
    retailerName: string;
    price: number;
    rating: number | null;
    reviewCount: number | null;
    availability: string;
  }>;
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.products)) return obj.products as Array<Record<string, unknown>>;
    if (Array.isArray(obj.items)) return obj.items as Array<Record<string, unknown>>;
  }
  return [];
}

function toDealCoupon(row: Record<string, unknown>): DealCoupon | null {
  const code = row.code as string | undefined;
  if (!code) return null;
  return {
    code,
    merchantId: (row.merchantId as string | null) ?? (row.merchant_id as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    discountType: (row.discountType as string | undefined) ?? (row.discount_type as string | undefined) ?? 'percentage',
    discountValue: Number(row.discountValue ?? row.discount_value ?? 0),
    minOrderValue: (row.minOrderValue as number | null) ?? (row.min_order_value as number | null) ?? null,
    maxDiscountAmount: (row.maxDiscountAmount as number | null) ?? (row.max_discount_amount as number | null) ?? null,
    usageLimit: (row.usageLimit as number | null) ?? (row.usage_limit as number | null) ?? null,
    usageCount: Number(row.usageCount ?? row.usage_count ?? 0),
    validFrom: (row.validFrom as string | null) ?? (row.valid_from as string | null) ?? null,
    validUntil: (row.validUntil as string | null) ?? (row.valid_until as string | null) ?? null,
    active: (row.active as boolean | undefined) ?? true,
  };
}

async function fetchJson(url: string): Promise<unknown> {
  // P0 fix (2026-11-09 audit): 15s hard timeout — a hanging API used
  // to keep this matrix on "Loading…" forever; on timeout the caller
  // falls back to the comparison data with "—" cells and an honest note.
  const res = await fetchTimed(url, 15000);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function renderCell(cell: MatrixCell, highlight: boolean) {
  if (cell === null) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  if (cell.kind === 'usd') {
    return (
      <span className={cn('font-bold', highlight && 'text-green-600')}>
        <Price usd={cell.usd} />
      </span>
    );
  }
  return <span className="text-sm">{cell.text}</span>;
}

/**
 * Decision Matrix — Enterprise feature #7.
 *
 * A tabular matrix comparing the selected products across real data
 * only (lowest price, category, brand, best valid coupon, 30-day
 * price change, lowest in 30 days, rating, reviews, availability).
 * Enrichment (category, coupons, price history) is fetched from the
 * public API routes; if it fails, the matrix still renders from the
 * comparison data with "—" for the missing cells and an honest note.
 */
export function DecisionMatrix({ products }: { products: DecisionMatrixProduct[] }) {
  const [inputs, setInputs] = useState<MatrixProductInput[] | null>(null);
  const [enrichmentFailed, setEnrichmentFailed] = useState(false);

  useEffect(() => {
    if (products.length < 2) return;
    let cancelled = false;
    (async () => {
      try {
        const [categories, couponsJson, merchantsJson, historiesJson] = await Promise.all([
          Promise.all(
            products.map(async (p) => {
              try {
                const data = (await fetchJson(`/api/v1/products/${encodeURIComponent(p.slug)}`)) as {
                  data?: Record<string, unknown>;
                };
                const row = data?.data ?? {};
                return (row.category as string | null) ?? null;
              } catch {
                return null;
              }
            })
          ),
          fetchJson('/api/v1/coupons?pageSize=200'),
          fetchJson('/api/v1/merchants?pageSize=100'),
          Promise.all(
            products.map(async (p) => {
              try {
                const data = (await fetchJson(
                  `/api/v1/products/${encodeURIComponent(p.slug)}/prices?limit=100`
                )) as { data?: unknown };
                return asArray(data?.data)
                  .map((row) => ({
                    price: Number(row.price),
                    recordedAt: (row.recordedAt as string | undefined) ?? (row.recorded_at as string | undefined) ?? '',
                  }))
                  .filter(
                    (pt): pt is PriceHistoryPoint =>
                      Number.isFinite(pt.price) && pt.price > 0 && pt.recordedAt !== ''
                  );
              } catch {
                return [] as PriceHistoryPoint[];
              }
            })
          ),
        ]);

        const coupons = asArray((couponsJson as { data?: unknown })?.data)
          .map(toDealCoupon)
          .filter((c): c is DealCoupon => c !== null);
        const merchantNameById: Record<string, string> = {};
        for (const row of asArray((merchantsJson as { data?: unknown })?.data)) {
          if (typeof row.id === 'string' && typeof row.name === 'string') {
            merchantNameById[row.id] = row.name;
          }
        }

        if (cancelled) return;
        setInputs(
          products.map((p, i) => ({
            productId: p.productId,
            slug: p.slug,
            name: p.name,
            brand: p.brand,
            category: categories[i],
            retailers: p.retailers,
            coupons,
            merchantNameById,
            priceHistory: historiesJson[i],
          }))
        );
      } catch {
        if (cancelled) return;
        // Enrichment failed entirely: render from comparison data
        // alone (categories/coupons/history all "—") and say so.
        setEnrichmentFailed(true);
        setInputs(
          products.map((p) => ({
            productId: p.productId,
            slug: p.slug,
            name: p.name,
            brand: p.brand,
            category: null,
            retailers: p.retailers,
            coupons: [],
            merchantNameById: {},
            priceHistory: [],
          }))
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [products]);

  if (products.length < 2) return null;

  const rows = inputs ? buildMatrixRows(inputs) : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Decision Matrix</CardTitle>
        <CardDescription>
          Every product, side by side, on recorded data only — lowest price, best valid
          coupon, and 30-day price movement.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {inputs === null ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <LoadingSpinner size="sm" />
            Loading matrix details…
          </div>
        ) : (
          <>
            {enrichmentFailed && (
              <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                Extra details (categories, coupons, price history) could not be loaded — the
                matrix below uses comparison data only.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b-2 border-slate-200 dark:border-slate-700">
                    <th className="p-3 text-left text-sm font-medium text-muted-foreground">Metric</th>
                    {products.map((p) => (
                      <th key={p.productId} className="p-3 text-left">
                        <span className="block font-semibold">{p.name}</span>
                        {p.brand && (
                          <span className="block text-xs font-normal text-muted-foreground">{p.brand}</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.key}
                      className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                    >
                      <td className="p-3 text-sm font-medium">{row.label}</td>
                      {row.cells.map((cell, i) => (
                        <td key={`${row.key}-${products[i].productId}`} className="p-3">
                          {renderCell(cell, row.highlight[i])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              — means no recorded data for this product. Prices are the lowest recorded merchant
              prices; coupons are the best currently-valid coupon for the product&apos;s retailers.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
