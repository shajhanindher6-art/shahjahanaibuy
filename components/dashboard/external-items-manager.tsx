'use client';

import { useState, useEffect, useCallback } from 'react';
import { ExternalLink, Plus, Trash2, Globe } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { storeDomainFromUrl } from '@/services/external-wishlist';

interface Wishlist {
  id: string;
  name: string;
}

interface ExternalItem {
  id: string;
  external_title: string;
  external_store: string | null;
  external_url: string | null;
  external_price: number | null;
  external_currency: string | null;
  product_id: string | null;
}

/**
 * External wishlist items (Option 8, Feature 5) — universal add-by-URL.
 * HONESTY: external items NEVER claim price tracking. They render as
 * "External item — price tracking unavailable" unless the user explicitly
 * links a catalog product by slug (validated server-side). A catalog match
 * is never applied automatically. True automatic one-click sync from every
 * store would require per-store integrations + sign-in + (for many stores)
 * scraping, which is blocked — this is add-by-URL + extension-local save,
 * not automatic sync.
 */
export function ExternalItemsManager() {
  const { toast } = useToast();
  const [wishlists, setWishlists] = useState<Wishlist[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [items, setItems] = useState<ExternalItem[] | null>(null);
  const [externalEnabled, setExternalEnabled] = useState(true);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [price, setPrice] = useState('');
  const [catalogSlug, setCatalogSlug] = useState('');
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadWishlists = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/wishlists');
      const data = await res.json();
      const lists: Wishlist[] = (data?.data ?? []).map((w: Record<string, unknown>) => ({
        id: w.id as string,
        name: w.name as string,
      }));
      setWishlists(lists);
      if (lists.length > 0 && !selectedId) setSelectedId(lists[0].id);
    } catch {
      setWishlists([]);
    }
  }, [selectedId]);

  const loadItems = useCallback(async () => {
    if (!selectedId) {
      setItems(null);
      return;
    }
    try {
      const res = await fetch(`/api/v1/wishlists/${selectedId}/items/external`);
      const data = await res.json();
      setItems(Array.isArray(data?.data) ? data.data : []);
      setExternalEnabled(data?.meta?.externalEnabled !== false);
    } catch {
      setItems([]);
    }
  }, [selectedId]);

  useEffect(() => {
    loadWishlists();
  }, [loadWishlists]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId) return;
    setAdding(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/v1/wishlists/${selectedId}/items/external`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          url,
          price: price === '' ? null : Number(price),
          catalogSlug: catalogSlug.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice((data?.error?.message as string) ?? 'Could not add external item.');
      } else {
        toast({ title: 'External item added' });
        setTitle(''); setUrl(''); setPrice(''); setCatalogSlug('');
        loadItems();
      }
    } catch {
      setNotice('Could not add external item.');
    } finally {
      setAdding(false);
    }
  };

  const remove = async (itemId: string) => {
    const res = await fetch(`/api/v1/wishlists/${selectedId}/items/${itemId}`, {
      method: 'DELETE',
    });
    if (res.ok) loadItems();
  };

  if (!externalEnabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-5 w-5" /> Add from any store
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            External wishlist items are not live yet — the owner still needs to run
            supabase/add-external-wishlist-items.sql.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe className="h-5 w-5" /> Add from any store (universal wishlist)
        </CardTitle>
        <CardDescription>
          Paste a product URL from any e-commerce store. This is add-by-URL, not automatic
          one-click sync — price tracking does not apply to external items unless you explicitly
          link a catalog product below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {wishlists.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Create a wishlist first, then add external items to it.
          </p>
        ) : (
          <>
            <div>
              <Label className="mb-1.5 block">Wishlist</Label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                {wishlists.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            <form onSubmit={add} className="space-y-3 border-t pt-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="mb-1.5 block">Product title *</Label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sony WH-1000XM5" required />
                </div>
                <div>
                  <Label className="mb-1.5 block">Product URL *</Label>
                  <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" required />
                </div>
                <div>
                  <Label className="mb-1.5 block">Price you saw (optional)</Label>
                  <Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 399.00" />
                </div>
                <div>
                  <Label className="mb-1.5 block">Link catalog product by slug (optional)</Label>
                  <Input value={catalogSlug} onChange={(e) => setCatalogSlug(e.target.value)} placeholder="e.g. sony-wh-1000xm5" />
                </div>
              </div>
              {url && storeDomainFromUrl(url) && (
                <p className="text-xs text-muted-foreground">Store detected: {storeDomainFromUrl(url)}</p>
              )}
              <Button type="submit" disabled={adding}>
                <Plus className="mr-2 h-4 w-4" /> Add external item
              </Button>
              {notice && <p className="text-sm">{notice}</p>}
            </form>
            <div className="space-y-2 border-t pt-4">
              {items === null ? (
                <p className="text-sm text-muted-foreground">Loading external items…</p>
              ) : items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No external items in this wishlist yet.</p>
              ) : (
                items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{item.external_title}</p>
                      <p className="text-muted-foreground">
                        {item.external_store ?? 'Unknown store'}
                        {item.external_price !== null && ` · ${item.external_currency ?? 'USD'} ${Number(item.external_price).toFixed(2)}`}
                      </p>
                      <Badge variant="secondary" className="mt-1">
                        {item.product_id
                          ? 'Linked to a catalog product'
                          : 'External item — price tracking unavailable'}
                      </Badge>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {item.external_url && (
                        <Button size="sm" variant="ghost" asChild>
                          <a href={item.external_url} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => remove(item.id)}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
