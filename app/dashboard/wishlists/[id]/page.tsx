'use client';

/**
 * Owner wishlist detail page: /dashboard/wishlists/[id]
 *
 * This route previously did not exist, so the "View" button on
 * /dashboard/wishlists pushed visitors to a 404. It now renders the
 * owner's own list: metadata from GET /api/v1/wishlists/[id]
 * (owner-only, 404 for other users' lists) and its items resolved
 * with real names/prices from GET /api/v1/tracking (filtered by
 * wishlistId), with remove-from-wishlist via the existing DELETE
 * item endpoint. External (add-by-URL) items are managed on the
 * wishlists overview page via ExternalItemsManager, not here.
 * A failed tracking fetch never hides the list itself — the items
 * section falls back to an honest "could not load items" note.
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Heart, Trash2, ArrowLeft, ArrowRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/hooks/use-toast';
import { ShareButtons } from '@/components/products/share-buttons';
// Section 12, Chunk E: polls on this wishlist — the owner creates
// them here; friends vote from the shared page. The component owns
// its own fetch/vote/create calls; this page only passes the list
// items as poll options.
import { WishlistPolls } from '@/components/wishlist/wishlist-polls';

interface WishlistMeta {
  id: string;
  name: string;
  description: string | null;
  isPublic: boolean;
}

interface TrackedItem {
  itemId: string;
  wishlistId: string;
  product: { id: string; name: string; slug: string; brand: string | null };
  targetPrice: number | null;
  currentPrice: number | null;
  belowTarget: boolean;
}

export default function DashboardWishlistDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { toast } = useToast();
  const [meta, setMeta] = useState<WishlistMeta | null>(null);
  const [items, setItems] = useState<TrackedItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  // Section 14, Chunk 7 — move an item to another of the owner's
  // lists (POST to the target, then DELETE here). Only lists other
  // than this one are offered; with one list there is nothing to
  // move to and no control renders.
  const [otherLists, setOtherLists] = useState<Array<{ id: string; name: string }>>([]);
  const [moveTarget, setMoveTarget] = useState<Record<string, string>>({});
  const [movingId, setMovingId] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    try {
      const metaRes = await fetch(`/api/v1/wishlists/${id}`);
      if (!metaRes.ok) {
        setNotFound(true);
        setMeta(null);
        setItems(null);
        return;
      }
      const metaData = await metaRes.json();
      if (metaData.success && metaData.data) {
        setMeta(metaData.data as WishlistMeta);
      } else {
        setNotFound(true);
        return;
      }
    } catch {
      setNotFound(true);
      return;
    } finally {
      setLoading(false);
    }
    try {
      const trackRes = await fetch('/api/v1/tracking');
      const trackData = await trackRes.json();
      const all: TrackedItem[] = trackData?.data?.items ?? [];
      setItems(all.filter((item) => item.wishlistId === id));
    } catch {
      setItems(null);
    }
    try {
      const listsRes = await fetch('/api/v1/wishlists');
      const listsData = await listsRes.json();
      const all: Array<{ id: string; name: string }> = (listsData?.data ?? [])
        .filter((w: { id: string }) => w.id !== id)
        .map((w: { id: string; name: string }) => ({ id: w.id, name: w.name }));
      setOtherLists(all);
    } catch {
      setOtherLists([]);
    }
  }, [id]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const removeItem = async (item: TrackedItem) => {
    try {
      const res = await fetch(`/api/v1/wishlists/${id}/items/${item.itemId}`, { method: 'DELETE' });
      if (res.ok) {
        toast({ title: 'Removed from wishlist' });
        fetchDetail();
      } else {
        toast({ title: 'Failed to remove item', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Failed to remove item', variant: 'destructive' });
    }
  };

  // Section 14, Chunk 7 — move to another list: add to the target
  // first, delete here only after the add confirms, so a failed
  // move never loses the item.
  const moveItem = async (item: TrackedItem) => {
    const targetId = moveTarget[item.itemId];
    if (!targetId || movingId) return;
    setMovingId(item.itemId);
    try {
      const addRes = await fetch(`/api/v1/wishlists/${targetId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: item.product.id }),
      });
      if (!addRes.ok) {
        toast({ title: 'Failed to move item', variant: 'destructive' });
        return;
      }
      const delRes = await fetch(`/api/v1/wishlists/${id}/items/${item.itemId}`, { method: 'DELETE' });
      if (!delRes.ok) {
        toast({ title: 'Item was added to the other list, but could not be removed here', variant: 'destructive' });
        return;
      }
      toast({ title: 'Item moved' });
      fetchDetail();
    } catch {
      toast({ title: 'Failed to move item', variant: 'destructive' });
    } finally {
      setMovingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (notFound || !meta) {
    return (
      <Card>
        <CardContent className="pt-6">
          <EmptyState
            icon={Heart}
            title="This wishlist is not available"
            description="It may belong to another account, or the link may be incorrect."
            action={
              <Button size="sm" asChild>
                <Link href="/dashboard/wishlists">Back to my wishlists</Link>
              </Button>
            }
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Button size="sm" variant="ghost" asChild className="mb-2 -ml-2">
          <Link href="/dashboard/wishlists">
            <ArrowLeft className="mr-1 h-4 w-4" /> All wishlists
          </Link>
        </Button>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Heart className="h-7 w-7 text-red-500" /> {meta.name}
        </h1>
        {meta.description && <p className="mt-1 text-muted-foreground">{meta.description}</p>}
        <Badge variant={meta.isPublic ? 'default' : 'secondary'} className="mt-2">
          {meta.isPublic ? 'Public' : 'Private'}
        </Badge>
        {/* Section 13, item 55 — share buttons on the owner detail
            page. The shared URL is the PUBLIC page (/wishlists/[id]),
            not this auth-gated dashboard URL — a dashboard link is
            useless to anyone the owner sends it to. */}
        <div className="mt-3">
          <ShareButtons
            title={`${meta.name} — shared wishlist on SmartBuy AI`}
            url={
              typeof window !== 'undefined'
                ? `${window.location.origin}/wishlists/${id}`
                : `/wishlists/${id}`
            }
          />
        </div>
      </div>

      {items === null ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Could not load this list&apos;s items right now. The list itself is unchanged —{' '}
              {/* Section 10 (2026-11-11): design-system Button, not a
                  raw <button> — h-auto/p-0 keep it an inline text
                  link (the adjacent Link is text-blue-600 too), so
                  the rendering is unchanged. */}
              <Button type="button" variant="link" className="h-auto p-0 text-sm text-blue-600" onClick={fetchDetail}>
                try again
              </Button>
              , or view all saved products on the{' '}
              <Link className="text-blue-600 underline" href="/dashboard/tracking">
                tracking page
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={Heart}
              title="This wishlist is empty"
              description="Save products from any product page, and they will appear here."
              action={
                <Button size="sm" asChild>
                  <Link href="/search">Browse products</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <Card key={item.itemId}>
              <CardContent className="p-4">
                <Link href={`/products/${item.product.slug}`}>
                  <h3 className="text-sm font-medium leading-tight hover:underline">{item.product.name}</h3>
                </Link>
                {item.product.brand && (
                  <p className="mt-1 text-xs text-muted-foreground">{item.product.brand}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  {item.belowTarget && <Badge variant="default">Below target</Badge>}
                  {item.targetPrice !== null && (
                    <span className="text-xs text-muted-foreground">
                      Target: ${item.targetPrice.toFixed(2)}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-lg font-bold">
                  {item.currentPrice !== null ? `$${item.currentPrice.toFixed(2)}` : 'Price unavailable'}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1" asChild>
                    <Link href={`/products/${item.product.slug}`}>
                      View product <ArrowRight className="ml-1 h-4 w-4" />
                    </Link>
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => removeItem(item)} aria-label="Remove from wishlist">
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
                {otherLists.length > 0 && (
                  <div className="mt-3 flex gap-2">
                    <select
                      className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs"
                      value={moveTarget[item.itemId] ?? ''}
                      onChange={(e) =>
                        setMoveTarget((prev) => ({ ...prev, [item.itemId]: e.target.value }))
                      }
                      aria-label={`Move ${item.product.name} to another wishlist`}
                    >
                      <option value="">Move to…</option>
                      {otherLists.map((list) => (
                        <option key={list.id} value={list.id}>
                          {list.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!moveTarget[item.itemId] || movingId === item.itemId}
                      onClick={() => void moveItem(item)}
                    >
                      {movingId === item.itemId ? 'Moving…' : 'Move'}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Section 12, Chunk E: polls on this wishlist. The owner
          creates a poll from the items above; friends vote on the
          shared page. Shown once the items load (even when empty —
          existing polls can outlive their items). */}
      {items !== null && (
        <WishlistPolls
          wishlistId={id}
          items={items.map((item) => ({
            productId: item.product.id,
            productName: item.product.name,
            productSlug: item.product.slug,
          }))}
          canCreate
        />
      )}
    </div>
  );
}
