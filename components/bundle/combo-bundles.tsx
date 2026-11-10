'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ComboBundleCard } from '@/components/bundle/combo-bundle-card';
import type { BundleItemInput, BundleTotals } from '@/lib/bundles';

/**
 * Combo bundle picker (Section 3, item 5).
 *
 * Pick a product, see its combo bundle: the product plus its
 * best-graded compatible catalogue products, priced from real
 * recorded merchant listings via GET /api/v1/bundles?comboFor=.
 * Honest empty states when nothing priced and compatible exists.
 */
interface ProductOption {
  slug: string;
  name: string;
}

interface ComboResponse {
  anchor: { slug: string; name: string };
  combo: { items: BundleItemInput[]; totals: BundleTotals } | null;
  message?: string;
}

export function ComboBundles() {
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [selected, setSelected] = useState('');
  const [combo, setCombo] = useState<ComboResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/v1/products?pageSize=100');
        const data = await res.json();
        const list: ProductOption[] = ((data?.data ?? []) as ProductOption[])
          .filter((p) => p.slug !== 'sample-laptop')
          .map((p) => ({ slug: p.slug, name: p.name }));
        if (!cancelled) {
          setProducts(list);
          if (list.length > 0) setSelected(list[0].slug);
        }
      } catch {
        if (!cancelled) setProducts([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadCombo = useCallback(async (slug: string) => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    setCombo(null);
    try {
      const res = await fetch(`/api/v1/bundles?comboFor=${encodeURIComponent(slug)}`);
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setError('Could not load a combo bundle for this product.');
        return;
      }
      setCombo(data.data as ComboResponse);
    } catch {
      setError('Could not load a combo bundle for this product.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selected) loadCombo(selected);
  }, [selected, loadCombo]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Combo bundles</CardTitle>
        <CardDescription>
          A product plus the compatible products that go with it — one total, from real recorded
          prices. No invented bundle discount.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {products.length === 0 ? (
          <p className="text-sm text-muted-foreground">No products available to build a bundle from.</p>
        ) : (
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Main product</span>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2"
            >
              {products.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {loading && <p className="text-sm text-muted-foreground">Building your combo bundle…</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!loading && !error && combo?.combo === null && (
          <p className="text-sm text-muted-foreground">
            {combo.message ??
              'No priced compatible products found in the catalogue for this product yet.'}
          </p>
        )}
        {!loading && !error && combo?.combo && (
          <ComboBundleCard items={combo.combo.items} totals={combo.combo.totals} />
        )}
      </CardContent>
    </Card>
  );
}
