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
import { cn } from '@/lib/utils';

interface WishlistButtonProps {
  productId: string;
  productName: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

interface Wishlist {
  id: string;
  name: string;
  itemCount?: number;
  createdAt: string;
}

export function WishlistButton({ productId, productName, variant = 'outline', size = 'default' }: WishlistButtonProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [wishlists, setWishlists] = useState<Wishlist[]>([]);
  const [loading, setLoading] = useState(false);
  const [addedTo, setAddedTo] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');

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

        {!user ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Heart className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Sign in to save products to your wishlists.
            </p>
            <Button asChild>
              <a href="/sign-in">Sign In</a>
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {wishlists.length === 0 && !showCreate && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                You don't have any wishlists yet. Create one to get started.
              </p>
            )}

            {wishlists.map((wl) => (
              <div
                key={wl.id}
                className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
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
        )}

        {user && (
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Done</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
