/**
 * AI Shopping List Optimizer — /tools/list-optimizer (Section 7, item 1).
 *
 * Client page: pick products from the catalog, set quantities, and see
 * the cheapest split computed from REAL recorded merchant listings —
 * which item from which store, per-store totals, and the saving versus
 * buying everything from one store. Saving the list is optional and
 * needs a sign-in; optimizing a list works without saving.
 *
 * A product with no recorded merchant listing is shown as "no listing"
 * and excluded from the totals — no price is ever invented.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ListChecks } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ListOptimization } from '@/lib/list-optimizer';

interface CatalogProduct {
  id: string;
  name: string;
  slug: string;
}

interface ListRow {
  productSlug: string;
  quantity: number;
}

interface SavedList {
  id: string;
  name: string;
  created_at: string;
}

interface OptimizerResponse {
  list?: SavedList;
  items?: ListRow[];
  optimization: ListOptimization;
  listsEnabled?: boolean;
}

export default function ListOptimizerPage() {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [rows, setRows] = useState<ListRow[]>([{ productSlug: '', quantity: 1 }]);
  const [listName, setListName] = useState('');
  const [optimization, setOptimization] = useState<ListOptimization | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [savedLists, setSavedLists] = useState<SavedList[]>([]);
  const [listsEnabled, setListsEnabled] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/v1/products?pageSize=100');
        const json = await res.json().catch(() => null);
        if (!cancelled && res.ok && json?.success && Array.isArray(json.data)) {
          setProducts(json.data as CatalogProduct[]);
        } else if (!cancelled) {
          setCatalogFailed(true);
        }
      } catch {
        if (!cancelled) setCatalogFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadSavedLists = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/tools/list-optimizer');
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success && json.data) {
        setSavedLists(Array.isArray(json.data.lists) ? json.data.lists : []);
        setListsEnabled(json.data.listsEnabled !== false);
      }
    } catch {
      // Saved lists are optional — optimizing still works without them.
    }
  }, []);

  useEffect(() => {
    void loadSavedLists();
  }, [loadSavedLists]);

  function updateRow(index: number, patch: Partial<ListRow>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    if (rows.length >= 50) return;
    setRows((prev) => [...prev, { productSlug: '', quantity: 1 }]);
  }

  function removeRow(index: number) {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  async function optimize() {
    const items = rows.filter((r) => r.productSlug.trim() !== '');
    if (items.length === 0) {
      setError('Add at least one product to the list first.');
      return;
    }
    if (!listName.trim()) {
      setError('Give the list a name before saving it.');
      return;
    }
    setError(null);
    setSavedNote(null);
    setSaving(true);
    try {
      const res = await fetch('/api/v1/tools/list-optimizer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: listName.trim() || 'My shopping list', items }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        const message =
          typeof json?.error?.message === 'string'
            ? json.error.message
            : 'Could not optimize this list. Please try again.';
        setError(
          res.status === 401
            ? 'Sign in to save and optimize a list.'
            : res.status === 503
              ? 'Shopping lists are not set up yet — the owner still needs to run migration 033 once.'
              : message
        );
        return;
      }
      const data = json.data as OptimizerResponse;
      setOptimization(data.optimization);
      setListsEnabled(data.listsEnabled !== false);
      setSavedNote(`Saved as “${listName.trim()}”.`);
      void loadSavedLists();
    } catch {
      setError('Could not optimize this list. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function openSavedList(listId: string) {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/tools/list-optimizer?list_id=${encodeURIComponent(listId)}`);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setError('Could not open that list.');
        return;
      }
      const data = json.data as OptimizerResponse;
      if (data.items) setRows(data.items);
      if (data.list) setListName(data.list.name);
      setOptimization(data.optimization);
    } catch {
      setError('Could not open that list.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-3xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <ListChecks className="h-7 w-7 text-blue-600" /> Shopping list optimizer
          </h1>
          <p className="mt-2 text-muted-foreground">
            Add the products on your list and see the cheapest way to buy
            them all — which item from which store — from real recorded
            merchant prices only. A product with no recorded listing is
            shown as “no listing” and left out of the totals; no price is
            ever invented.
          </p>

          {catalogFailed ? (
            <div className="mt-8 rounded-lg border p-6">
              <p className="font-medium">Could not load the product catalog.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                The catalog could not be read right now. Please try again later.
              </p>
            </div>
          ) : (
            <div className="mt-8 space-y-3">
              {rows.map((row, index) => (
                <div key={index} className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
                  <div className="min-w-56 flex-1">
                    <Label htmlFor={`product-${index}`}>Product {index + 1}</Label>
                    <select
                      id={`product-${index}`}
                      className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                      value={row.productSlug}
                      onChange={(e) => updateRow(index, { productSlug: e.target.value })}
                    >
                      <option value="">Choose a product…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.slug}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="w-24">
                    <Label htmlFor={`qty-${index}`}>Quantity</Label>
                    <Input
                      id={`qty-${index}`}
                      type="number"
                      min={1}
                      max={99}
                      value={row.quantity}
                      onChange={(e) =>
                        updateRow(index, {
                          quantity: Math.max(1, Math.min(99, Number(e.target.value) || 1)),
                        })
                      }
                    />
                  </div>
                  {rows.length > 1 ? (
                    <Button variant="outline" onClick={() => removeRow(index)}>
                      Remove
                    </Button>
                  ) : null}
                </div>
              ))}
              <div className="flex flex-wrap gap-3">
                <Button variant="outline" onClick={addRow} disabled={rows.length >= 50}>
                  + Add another product
                </Button>
              </div>

              <div>
                <Label htmlFor="list-name">List name (to save it)</Label>
                <Input
                  id="list-name"
                  value={listName}
                  onChange={(e) => setListName(e.target.value)}
                  placeholder="e.g. Birthday tech list"
                  maxLength={100}
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <Button onClick={() => void optimize()} disabled={loading || saving}>
                  {saving ? 'Saving…' : 'Optimize & save list'}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Optimizing saves the list to your account (sign-in required).
                Prices are re-read from recorded merchant listings each time
                you open a saved list.
              </p>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              {savedNote ? <p className="text-sm text-green-700">{savedNote}</p> : null}
            </div>
          )}

          {loading ? (
            <div className="mt-8 flex justify-center">
              <LoadingSpinner />
            </div>
          ) : optimization ? (
            <div className="mt-8">
              <h2 className="text-xl font-semibold">Cheapest way to buy this list</h2>
              {optimization.splitTotal !== null ? (
                <p className="mt-2 text-lg">
                  Total: <strong>${optimization.splitTotal.toFixed(2)}</strong>
                  {optimization.savingVsSingleStore !== null &&
                  optimization.savingVsSingleStore > 0 &&
                  optimization.bestSingleStore ? (
                    <span className="text-muted-foreground">
                      {' '}
                      — saves ${optimization.savingVsSingleStore.toFixed(2)} versus buying
                      everything from {optimization.bestSingleStore.store}.
                    </span>
                  ) : null}
                </p>
              ) : (
                <p className="mt-2 text-muted-foreground">
                  No total yet — no item in this list has a recorded merchant listing.
                </p>
              )}

              <table className="mt-4 w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 pr-2">Product</th>
                    <th className="py-2 pr-2">Qty</th>
                    <th className="py-2 pr-2">Cheapest store</th>
                    <th className="py-2 text-right">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {optimization.items.map((item) => (
                    <tr key={item.productSlug} className="border-b">
                      <td className="py-2 pr-2">
                        <Link
                          href={`/products/${item.productSlug}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {item.productSlug}
                        </Link>
                      </td>
                      <td className="py-2 pr-2">{item.quantity}</td>
                      <td className="py-2 pr-2">
                        {item.hasListing ? item.store : 'No listing'}
                      </td>
                      <td className="py-2 text-right">
                        {item.lineTotal !== null ? `$${item.lineTotal.toFixed(2)}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {optimization.storeTotals.length > 0 ? (
                <div className="mt-6">
                  <h3 className="font-semibold">Per-store totals</h3>
                  <ul className="mt-2 space-y-1 text-sm">
                    {optimization.storeTotals.map((s) => (
                      <li key={s.store}>
                        {s.store}: ${s.total.toFixed(2)}
                        {s.carriesAllPricedItems ? ' (carries the whole priced list)' : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {optimization.notes.map((note) => (
                <p key={note} className="mt-4 text-sm text-muted-foreground">
                  {note}
                </p>
              ))}
            </div>
          ) : null}

          {listsEnabled && savedLists.length > 0 ? (
            <div className="mt-10">
              <h2 className="text-xl font-semibold">Your saved lists</h2>
              <ul className="mt-3 space-y-2">
                {savedLists.map((list) => (
                  <li key={list.id} className="flex items-center justify-between rounded-lg border p-4">
                    <span className="font-medium">{list.name}</span>
                    <Button variant="outline" onClick={() => void openSavedList(list.id)}>
                      Open & optimize
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : !listsEnabled ? (
            <p className="mt-10 text-sm text-muted-foreground">
              Saved lists are not set up yet — the owner still needs to run
              migration 033 once. Until then, lists cannot be saved or optimized.
            </p>
          ) : null}

          {optimization === null && !loading ? (
            <div className="mt-8">
              <EmptyState
                title="No list optimized yet"
                description="Pick products above and optimize the list to see the cheapest store split."
              />
            </div>
          ) : null}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
