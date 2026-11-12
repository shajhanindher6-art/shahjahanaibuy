'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Heart, Plus, Share2, Trash2, Bell, ArrowRight, Pencil } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/hooks/use-toast';
import { ExternalItemsManager } from '@/components/dashboard/external-items-manager';
import { tFor } from '@/lib/i18n';
import { useRegion } from '@/components/region/region-provider';

interface Wishlist {
  id: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  itemCount: number;
  createdAt: string;
  /** Polls on this list (Section 13, item 53) — batched into the
      GET /api/v1/wishlists response; 0 when there are none. */
  pollCount?: number;
}

export default function WishlistsPage() {
  // Section 16, #42: Save/Cancel render through tFor (existing keys
  // only) like the deals page.
  const { language } = useRegion();
  const router = useRouter();
  const { toast } = useToast();
  const [wishlists, setWishlists] = useState<Wishlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  // Section 14, Chunk 7 — inline rename (the PATCH endpoint
  // already accepted { name }; the UI had no way to use it).
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

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
          pollCount: (w.pollCount as number) ?? 0,
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

  // Section 14, Chunk 7 — rename via the existing PATCH endpoint.
  // Empty names are rejected client-side; a failed PATCH leaves the
  // old name in place.
  const saveRename = async (id: string) => {
    const name = renameValue.trim();
    if (!name) {
      toast({ title: 'A wishlist needs a name', variant: 'destructive' });
      return;
    }
    setRenaming(true);
    try {
      const res = await fetch(`/api/v1/wishlists/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.slice(0, 100) }),
      });
      if (res.ok) {
        toast({ title: 'Wishlist renamed' });
        setRenamingId(null);
        fetchWishlists();
      } else {
        toast({ title: 'Failed to rename wishlist', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Failed to rename wishlist', variant: 'destructive' });
    } finally {
      setRenaming(false);
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
                <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>{tFor(language, 'commonCancel')}</Button>
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
                  <div className="min-w-0 flex-1">
                    {renamingId === wl.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void saveRename(wl.id);
                            if (e.key === 'Escape') setRenamingId(null);
                          }}
                          className="h-8"
                          maxLength={100}
                          autoFocus
                          aria-label="Wishlist name"
                        />
                        <Button size="sm" onClick={() => void saveRename(wl.id)} disabled={renaming}>
                          {tFor(language, 'commonSave')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setRenamingId(null)}>
                          {tFor(language, 'commonCancel')}
                        </Button>
                      </div>
                    ) : (
                      <CardTitle className="text-base">{wl.name}</CardTitle>
                    )}
                    {wl.description && <p className="mt-1 text-sm text-muted-foreground">{wl.description}</p>}
                  </div>
                  <Badge variant={wl.isPublic ? 'default' : 'secondary'}>
                    {wl.isPublic ? 'Public' : 'Private'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Heart className="h-4 w-4" />
                    {wl.itemCount} item{wl.itemCount !== 1 ? 's' : ''}
                  </span>
                  {/* Section 13, item 53 — poll count from the
                      batched API field, and the "Ask friends to
                      vote" link to the detail page where polls are
                      created and voted on. */}
                  {(wl.pollCount ?? 0) > 0 && (
                    <Badge variant="secondary">
                      {wl.pollCount} poll{(wl.pollCount ?? 0) !== 1 ? 's' : ''}
                    </Badge>
                  )}
                </div>
                <div className="mb-3">
                  <Button
                    size="sm"
                    variant="link"
                    className="h-auto p-0 text-sm"
                    onClick={() => router.push(`/dashboard/wishlists/${wl.id}`)}
                  >
                    Ask friends to vote
                  </Button>
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
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setRenamingId(wl.id);
                      setRenameValue(wl.name);
                    }}
                    aria-label={`Rename ${wl.name}`}
                  >
                    <Pencil className="h-4 w-4" />
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

      {/* Option 8, Feature 5: add products from ANY store by pasting a URL.
          External items never claim price tracking unless the user
          explicitly links a catalog product. */}
      <ExternalItemsManager />
    </div>
  );
}
