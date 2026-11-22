'use client';

import { useState, useEffect } from 'react';
import { Heart, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/features/auth';
import { trackEvent } from '@/components/analytics/track-event';
import { cn } from '@/lib/utils';
import {
  GUEST_WISHLIST_EVENT,
  isGuestWishlisted,
  toggleGuestWishlist,
} from '@/lib/guest-wishlist';

interface WishlistButtonProps {
  productId: string;
  productName: string;
  /** Slug for the guest (localStorage) wishlist entry; optional for callers that only have an id. */
  productSlug?: string;
  /** Product category, when the caller knows it (used only as a PostHog event property — never a product id). */
  productCategory?: string | null;
  /** Page / UI location, when the caller knows it (e.g. 'product_page', 'search_results'). */
  source?: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

interface Wishlist {
  id: string;
  name: string;
  itemCount?: number;
  createdAt: string;
}

export function WishlistButton({ productId, productName, productSlug, productCategory, source, variant = 'outline', size = 'default' }: WishlistButtonProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [wishlists, setWishlists] = useState<Wishlist[]>([]);
  const [loading, setLoading] = useState(false);
  const [addedTo, setAddedTo] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  // Guest (signed-out) wishlist state, kept in sync across every
  // WishlistButton on the page via the guest-wishlist event.
  const [guestSaved, setGuestSaved] = useState(false);

  useEffect(() => {
    const sync = () => setGuestSaved(isGuestWishlisted(productId));
    sync();
    window.addEventListener(GUEST_WISHLIST_EVENT, sync);
    return () => window.removeEventListener(GUEST_WISHLIST_EVENT, sync);
  }, [productId]);

  // PostHog: the approved event properties for a wishlist add.
  // Built fresh per call so absent values are omitted (never sent
  // as null/undefined). No product id is ever sent — the brief
  // forbids ids that could identify a user's private records.
  const wishlistEventProps = (): { product_category?: string; source?: string } => {
    const props: { product_category?: string; source?: string } = {};
    if (productCategory) props.product_category = productCategory;
    if (source) props.source = source;
    return props;
  };

  const handleGuestToggle = () => {
    const saved = toggleGuestWishlist({
      id: productId,
      slug: productSlug ?? '',
      name: productName,
    });
    setGuestSaved(saved);
    // PostHog: track ONLY the add (saved === true), never the
    // remove. A guest save is a real wishlist addition (device-
    // local). trackEvent() is consent-gated and never throws.
    if (saved) trackEvent('product_added_to_wishlist', wishlistEventProps());
    toast({
      title: saved ? 'Saved on this device' : 'Removed from wishlist',
      description: saved
        ? `${productName} is in your wishlist on this device. Sign in to keep it across devices.`
        : `${productName} was removed from your device wishlist.`,
    });
  };

  // Section 18, item 76 (lint): this fetch helper + effect MUST
  // sit above the `if (!user)` early return below — a hook after
  // a conditional return is a rules-of-hooks violation (hook order
  // would change between renders). Behaviour is unchanged: for
  // guests `open` is never true (the dialog is signed-in only),
  // so the effect never fetches for them.
  const fetchWishlists = async () => {
    try {
      const res = await fetch('/api/v1/wishlists');
      const data = await res.json();
      if (data.success) {
        setWishlists(data.data ?? []);
      }
    } catch { setWishlists([]); }
  };

  useEffect(() => {
    if (open) fetchWishlists();
  }, [open]);

  // P0 fix (2026-11-09 audit): guests used to hit a sign-in wall with
  // no way to save anything. A guest tap now toggles the device-local
  // wishlist directly; the dialog (server wishlists) is signed-in only.
  if (!user) {
    return (
      <Button variant={variant} size={size} onClick={handleGuestToggle}>
        <Heart
          className={cn('mr-2 h-4 w-4', guestSaved && 'fill-red-500 text-red-500')}
        />
        {guestSaved ? 'Saved' : 'Wishlist'}
      </Button>
    );
  }

  const handleAdd = async (wishlistId: string, wishlistName: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/wishlists/${wishlistId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
      });
      const data = await res.json();
      if (data.success) {
        setAddedTo(new Set([...addedTo, wishlistId]));
        // PostHog: track ONLY after the server confirms the add.
        // trackEvent() is consent-gated and never throws.
        trackEvent('product_added_to_wishlist', wishlistEventProps());
        toast({ title: 'Added to wishlist', description: `${productName} added to "${wishlistName}".` });
      } else {
        toast({ title: 'Failed to add', description: data.error?.message ?? 'Please try again.', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Failed to add', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/v1/wishlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchWishlists();
        setShowCreate(false);
        setNewName('');
        toast({ title: 'Wishlist created' });
      }
    } catch {
      toast({ title: 'Failed to create wishlist', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size}>
          <Heart className="mr-2 h-4 w-4" /> Wishlist
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Heart className="h-5 w-5 text-red-500" />
            Add to Wishlist
          </DialogTitle>
          <DialogDescription>
            Choose a wishlist to add {productName} to.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {wishlists.length === 0 && !showCreate && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              You don&apos;t have any wishlists yet. Create one to get started.
            </p>
          )}

            {wishlists.map((wl) => (
              <div
                key={wl.id}
                className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50 dark:hover:bg-muted"
              >
                <div>
                  <span className="font-medium text-sm">{wl.name}</span>
                  {wl.itemCount != null && (
                    <span className="ml-2 text-xs text-muted-foreground">{wl.itemCount} items</span>
                  )}
                </div>
                <Button
                  size="sm"
                  variant={addedTo.has(wl.id) ? 'default' : 'outline'}
                  onClick={() => handleAdd(wl.id, wl.name)}
                  disabled={loading || addedTo.has(wl.id)}
                >
                  {addedTo.has(wl.id) ? (
                    <><Check className="mr-1 h-4 w-4 text-green-500" /> Added</>
                  ) : (
                    'Add'
                  )}
                </Button>
              </div>
            ))}

            {showCreate ? (
              <div className="space-y-2 rounded-lg border p-3">
                <Label className="text-sm">Wishlist Name</Label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Birthday Gifts"
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleCreate} disabled={loading || !newName.trim()}>
                    Create
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowCreate(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" size="sm" className="w-full" onClick={() => setShowCreate(true)}>
                Create New Wishlist
              </Button>
            )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
