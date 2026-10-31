'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Heart, Plus, Share2, Trash2, Bell, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/hooks/use-toast';

interface Wishlist {
  id: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  itemCount: number;
  createdAt: string;
}

export default function WishlistsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [wishlists, setWishlists] = useState<Wishlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchWishlists = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/wishlists');
      const data = await res.json();
      if (data.success) {
        setWishlists((data.data ?? []).map((w: Record<string, unknown>) => ({
          id: w.id as string,
          name: w.name as string,
          description: w.description as string | null,
          isPublic: w.isPublic as boolean,
          itemCount: (w.itemCount as number) ?? 0,
          createdAt: w.createdAt as string,
        })));
      }
    } catch {
      setWishlists([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWishlists();
  }, [fetchWishlists]);

  const createWishlist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/v1/wishlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, description: newDesc || undefined, isPublic: false }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: 'Wishlist created!' });
        setNewName('');
        setNewDesc('');
        setShowCreate(false);
        fetchWishlists();
      } else {
        toast({ title: 'Failed to create wishlist', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Failed to create wishlist', variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const deleteWishlist = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/wishlists/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast({ title: 'Wishlist deleted' });
        fetchWishlists();
      }
    } catch {
      toast({ title: 'Failed to delete wishlist', variant: 'destructive' });
    }
  };

  // Generate a shareable link for a wishlist. The public page only
  // shows lists marked public, so a private list is first made public
  // (PATCH) — and only then is the link copied. If making it public
  // fails, no link is copied, so the recipient never gets a link
  // that just shows "not available".
  const shareWishlist = async (id: string) => {
    const current = wishlists.find((w) => w.id === id);
    try {
      if (current && !current.isPublic) {
        const res = await fetch(`/api/v1/wishlists/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isPublic: true }),
        });
        if (!res.ok) throw new Error('Failed to make wishlist public');
        setWishlists((prev) => prev.map((w) => (w.id === id ? { ...w, isPublic: true } : w)));
      }
      const url = `${window.location.origin}/wishlists/${id}`;
      await navigator.clipboard.writeText(url);
      toast({ title: 'Wishlist link copied to clipboard!' });
    } catch {
      toast({ title: 'Failed to share wishlist', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Heart className="h-7 w-7 text-red-500" />
            My Wishlists
          </h1>
          <p className="mt-1 text-muted-foreground">Organize, track, and share your favorite products</p>
        </div>
        <Button onClick={() => setShowCreate(!showCreate)}>
          <Plus className="mr-2 h-4 w-4" /> New List
        </Button>
      </div>

      {showCreate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create New Wishlist</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={createWishlist} className="space-y-4">
              <div>
                <Label className="mb-1.5 block">Name</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Birthday Gifts" required />
              </div>
              <div>
                <Label className="mb-1.5 block">Description (optional)</Label>
                <Input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="e.g. Things I want for my birthday" />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={creating}>
                  {creating ? <LoadingSpinner size="sm" /> : 'Create'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
      ) : wishlists.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {wishlists.map((wl) => (
            <Card key={wl.id} className="transition-shadow hover:shadow-md">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base">{wl.name}</CardTitle>
                    {wl.description && <p className="mt-1 text-sm text-muted-foreground">{wl.description}</p>}
                  </div>
                  <Badge variant={wl.isPublic ? 'default' : 'secondary'}>
                    {wl.isPublic ? 'Public' : 'Private'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <Heart className="h-4 w-4" />
                  {wl.itemCount} item{wl.itemCount !== 1 ? 's' : ''}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => router.push(`/dashboard/wishlists/${wl.id}`)}
                  >
                    View <ArrowRight className="ml-1 h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => shareWishlist(wl.id)}>
                    <Share2 className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => deleteWishlist(wl.id)}>
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={Heart}
              title="No wishlists yet"
              description="Create a wishlist to save and track products you're interested in."
              action={
                <Button onClick={() => setShowCreate(true)}>
                  <Plus className="mr-2 h-4 w-4" /> Create Wishlist
                </Button>
              }
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
