/**
 * My Tracking — the unified wishlist + price history + alerts dashboard.
 *
 * One page, one API call (GET /api/v1/tracking), three sections that
 * used to live in three places:
 *   1. Summary: saved products, active alerts, recent price drops,
 *      items already below their target price.
 *   2. Saved products: every wishlist item with its current price,
 *      price change, a mini trend sparkline (real price_history, no
 *      invented trend), its target price, and remove-from-wishlist.
 *   3. Price alerts: every alert with its product, type, target,
 *      channel, trigger count and last trigger — with an on/off
 *      switch, an editable target price (price_drop alerts), and
 *      delete. All edits go through the existing PATCH / DELETE
 *      /api/v1/alerts/[id] endpoints, so ownership checks are the
 *      same as everywhere else; this page adds no new write path.
 *
 * To create a NEW alert, use the product page's price-alert dialog
 * (it needs a product context); this page manages alerts that exist.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Heart, Bell, TrendingDown, Target, Trash2, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { PriceTrendSparkline } from '@/components/products/price-trend-sparkline';
import { useToast } from '@/hooks/use-toast';

interface TrackedItem {
  itemId: string;
  wishlistId: string;
  wishlistName: string;
  product: { id: string; name: string; slug: string; brand: string | null; category: string | null; imageUrl: string | null };
  targetPrice: number | null;
  notes: string | null;
  addedAt: string;
  currentPrice: number | null;
  previousPrice: number | null;
  changePct: number | null;
  belowTarget: boolean;
}

interface TrackedAlert {
  id: string;
  productId: string;
  productName: string;
  productSlug: string | null;
  alertType: string;
  conditionValue: number | null;
  channel: string;
  active: boolean;
  lastTriggeredAt: string | null;
  triggerCount: number;
  createdAt: string;
}

interface TrackingData {
  items: TrackedItem[];
  alerts: TrackedAlert[];
  summary: { savedCount: number; activeAlerts: number; priceDrops: number; belowTarget: number };
}

export default function TrackingPage() {
  const { toast } = useToast();
  const [data, setData] = useState<TrackingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingTarget, setEditingTarget] = useState<Record<string, string>>({});

  const fetchTracking = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/tracking');
      const json = await res.json();
      if (json.success) setData(json.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTracking();
  }, [fetchTracking]);

  const removeItem = async (item: TrackedItem) => {
    try {
      const res = await fetch(`/api/v1/wishlists/${item.wishlistId}/items/${item.itemId}`, { method: 'DELETE' });
      if (res.ok) {
        toast({ title: 'Removed from wishlist' });
        fetchTracking();
      } else {
        toast({ title: 'Failed to remove item', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Failed to remove item', variant: 'destructive' });
    }
  };

  const patchAlert = async (id: string, body: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/v1/alerts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        fetchTracking();
        return true;
      }
      toast({ title: 'Failed to update alert', variant: 'destructive' });
      return false;
    } catch {
      toast({ title: 'Failed to update alert', variant: 'destructive' });
      return false;
    }
  };

  const deleteAlert = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/alerts/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast({ title: 'Alert deleted' });
        fetchTracking();
      } else {
        toast({ title: 'Failed to delete alert', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Failed to delete alert', variant: 'destructive' });
    }
  };

  const saveTarget = async (alert: TrackedAlert) => {
    const raw = editingTarget[alert.id];
    const value = raw === undefined ? alert.conditionValue : Number(raw);
    if (!Number.isFinite(value as number) || (value as number) <= 0) {
      toast({ title: 'Enter a valid target price', variant: 'destructive' });
      return;
    }
    if (await patchAlert(alert.id, { conditionValue: value })) {
      toast({ title: 'Target price updated' });
      setEditingTarget((prev) => {
        const next = { ...prev };
        delete next[alert.id];
        return next;
      });
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="pt-6">
          <EmptyState
            icon={Heart}
            title="Could not load your tracking dashboard"
            description="Please try again later."
            action={
              <Button size="sm" onClick={fetchTracking}>
                Retry
              </Button>
            }
          />
        </CardContent>
      </Card>
    );
  }

  const { items, alerts, summary } = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Target className="h-7 w-7 text-primary" />
          My Tracking
        </h1>
        <p className="mt-1 text-muted-foreground">
          Your saved products, their price history, and your custom price drop alerts — in one place.
        </p>
      </div>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { icon: Heart, label: 'Saved products', value: summary.savedCount },
          { icon: Bell, label: 'Active alerts', value: summary.activeAlerts },
          { icon: TrendingDown, label: 'Recent price drops', value: summary.priceDrops },
          { icon: Target, label: 'Below target price', value: summary.belowTarget },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="flex items-center gap-3 p-4">
              <stat.icon className="h-6 w-6 text-primary" />
              <div>
                <div className="text-2xl font-bold">{stat.value}</div>
                <div className="text-xs text-muted-foreground">{stat.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Saved products */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">Saved products</h2>
        {items.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <Card key={item.itemId} className="transition-shadow hover:shadow-md">
                <CardContent className="p-4">
                  <Link href={`/products/${item.product.slug}`}>
                    <div className="mb-3 h-32 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                      {item.product.imageUrl ? (
                        <img src={item.product.imageUrl} alt={item.product.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          <Heart className="h-8 w-8 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <h3 className="text-sm font-medium leading-tight">{item.product.name}</h3>
                  </Link>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant="secondary">{item.wishlistName}</Badge>
                    {item.belowTarget && <Badge variant="default">Below target</Badge>}
                  </div>
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="text-lg font-bold">
                      {item.currentPrice !== null ? `$${item.currentPrice.toFixed(2)}` : 'Price unavailable'}
                    </span>
                    {item.changePct !== null && (
                      <span className={item.changePct < 0 ? 'text-sm text-green-600' : 'text-sm text-red-600'}>
                        {item.changePct >= 0 ? '+' : ''}
                        {item.changePct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <PriceTrendSparkline slug={item.product.slug} showChange={false} className="mt-2" />
                  <div className="mt-2 text-xs text-muted-foreground">
                    {item.targetPrice !== null ? `Target: $${item.targetPrice.toFixed(2)}` : 'No target price set'}
                    {item.previousPrice !== null && ` · Previous: $${item.previousPrice.toFixed(2)}`}
                  </div>
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
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="pt-6">
              <EmptyState
                icon={Heart}
                title="No saved products yet"
                description="Save products from any product page, and they will appear here with their price history."
                action={
                  <Button size="sm" asChild>
                    <Link href="/search">Browse products</Link>
                  </Button>
                }
              />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Price alerts */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">Price alerts</h2>
        {alerts.length > 0 ? (
          <div className="space-y-3">
            {alerts.map((alert) => (
              <Card key={alert.id}>
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    {alert.productSlug ? (
                      <Link href={`/products/${alert.productSlug}`} className="font-medium hover:underline">
                        {alert.productName}
                      </Link>
                    ) : (
                      <span className="font-medium">{alert.productName}</span>
                    )}
                    <div className="mt-1 flex flex-wrap gap-2">
                      <Badge variant="secondary">{alert.alertType.replace('_', ' ')}</Badge>
                      <Badge variant="outline">{alert.channel}</Badge>
                      {alert.triggerCount > 0 && (
                        <span className="text-xs text-muted-foreground">
                          Triggered {alert.triggerCount} time{alert.triggerCount !== 1 ? 's' : ''}
                          {alert.lastTriggeredAt && ` · Last: ${new Date(alert.lastTriggeredAt).toLocaleDateString()}`}
                        </span>
                      )}
                    </div>
                    {alert.alertType === 'price_drop' && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Target price $</span>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          className="h-8 w-28"
                          value={editingTarget[alert.id] ?? (alert.conditionValue !== null ? String(alert.conditionValue) : '')}
                          onChange={(e) => setEditingTarget((prev) => ({ ...prev, [alert.id]: e.target.value }))}
                        />
                        <Button size="sm" variant="outline" onClick={() => saveTarget(alert)}>
                          Save
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{alert.active ? 'On' : 'Off'}</span>
                      <Switch checked={alert.active} onCheckedChange={(checked) => patchAlert(alert.id, { active: checked })} />
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => deleteAlert(alert.id)} aria-label="Delete alert">
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
                icon={Bell}
                title="No price alerts yet"
                description="Open any product page and set a price alert there — it will appear here, ready to manage."
                action={
                  <Button size="sm" asChild>
                    <Link href="/deals">Browse deals</Link>
                  </Button>
                }
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
