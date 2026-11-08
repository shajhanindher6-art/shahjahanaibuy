'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { fetchProductAttributes } from '@/lib/fetch-product-attributes';
import { buildSpecMatrix } from '@/services/spec-matrix';
import type { ProductAttribute } from '@/types/catalog';

/**
 * A product as the Spec Matrix consumes it — structurally the same
 * shape the compare page already holds (extra fields on the caller's
 * objects are fine; only these fields are read).
 */
export interface SpecMatrixProduct {
  productId: string;
  slug: string;
  name: string;
  brand: string | null;
}

/**
 * Spec Matrix — Option 14-B.
 *
 * The compared products side by side on their REAL seeded
 * specifications (RAM, Storage, Battery, …) — rows are the union of
 * attribute keys, values are verbatim from the database, and a
 * product without a given spec shows "—", never an invented value.
 *
 * Attributes are loaded per product from the existing public
 * endpoint GET /api/v1/products/[slug] (attributes[]). While
 * loading, a spinner shows; if every fetch fails the whole section
 * hides (a broken network must not render fake specs); if the fetch
 * succeeds but no specs are recorded for these products, an honest
 * empty state says so.
 */
export function SpecMatrix({ products }: { products: SpecMatrixProduct[] }) {
  const [attributesByProductId, setAttributesByProductId] = useState<Record<
    string,
    ProductAttribute[]
  > | null>(null);
  const [allFailed, setAllFailed] = useState(false);

  useEffect(() => {
    if (products.length < 2) return;
    let cancelled = false;
    (async () => {
      const results = await Promise.all(products.map((p) => fetchProductAttributes(p.slug)));
      if (cancelled) return;
      // If every fetch failed, the section hides entirely — a broken
      // endpoint must not render an empty state for data it never saw.
      // A successful fetch with zero rows is the honest empty state.
      setAllFailed(results.every((r) => !r.ok));
      setAttributesByProductId(
        Object.fromEntries(products.map((p, i) => [p.productId, results[i].attributes]))
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [products]);

  if (products.length < 2) return null;
  if (allFailed) return null;

  const inputs =
    attributesByProductId === null
      ? null
      : products.map((p) => ({
          productId: p.productId,
          name: p.name,
          attributes: attributesByProductId[p.productId] ?? [],
        }));
  const rows = inputs ? buildSpecMatrix(inputs) : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Specification Comparison</CardTitle>
        <CardDescription>
          Seeded specifications, side by side — RAM, storage, battery and more, exactly as
          recorded for each product.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {inputs === null ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <LoadingSpinner size="sm" />
            Loading specifications…
          </div>
        ) : rows.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            No specifications recorded for these products yet.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b-2 border-slate-200 dark:border-slate-700">
                    <th className="p-3 text-left text-sm font-medium text-muted-foreground">
                      Specification
                    </th>
                    {products.map((p) => (
                      <th key={p.productId} className="p-3 text-left">
                        <span className="block font-semibold">{p.name}</span>
                        {p.brand && (
                          <span className="block text-xs font-normal text-muted-foreground">
                            {p.brand}
                          </span>
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
                        <td key={`${row.key}-${products[i].productId}`} className="p-3 text-sm">
                          {cell === null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            cell
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              — means no specification recorded for this product. Values are shown exactly as
              stored, with their stored units.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
