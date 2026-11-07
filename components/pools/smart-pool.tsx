'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { poolProgress, POOL_NO_GUARANTEE_NOTE } from '@/services/smartpool';
import { PoolMilestones } from '@/components/pools/pool-milestones';
import { PoolShippingSplit } from '@/components/pools/pool-shipping-split';

interface Pool {
  id: string;
  product_id: string | null;
  product_name: string;
  region_code: string;
  /** Optional shared city (null = region-scoped only, or column not yet migrated). */
  city?: string | null;
  /** Creator-supplied shipping estimate in USD (null = no estimate). */
  shippingEstimateUsd?: number | null;
  threshold: number;
  memberCount: number;
  status: string;
  created_at: string;
}

/**
 * SmartPool group buying (Option 8, Feature 2). Logged-in only for create
 * and join; guests see a sign-in note. Member counts are always real —
 * the creator is member #1 and the count only grows by real joins.
 * Reaching a threshold NEVER promises a discount (see the note below).
 */
export function SmartPool({
  productId,
  productName,
  regionCode,
}: {
  productId: string;
  productName: string;
  regionCode: string;
}) {
  const [pools, setPools] = useState<Pool[] | null>(null);
  const [poolsEnabled, setPoolsEnabled] = useState(true);
  const [threshold, setThreshold] = useState(10);
  const [city, setCity] = useState('');
  const [shippingEstimate, setShippingEstimate] = useState<number>(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/pools?productId=${encodeURIComponent(productId)}`);
      const data = await res.json();
      // The 018 migration columns (city, shippingEstimateUsd) may not
      // exist yet — normalize defensively so a missing column degrades
      // to the honest empty states instead of crashing.
      setPools(
        ((data?.data ?? []) as Array<Record<string, unknown>>).map((p) => ({
          ...(p as unknown as Pool),
          city: typeof p.city === 'string' && p.city ? p.city : null,
          shippingEstimateUsd:
            typeof p.shippingEstimateUsd === 'number' ? p.shippingEstimateUsd : null,
        }))
      );
      setPoolsEnabled(data?.meta?.poolsEnabled !== false);
    } catch {
      setPools([]);
    }
  }, [productId]);

  useEffect(() => {
    load();
  }, [load]);

  const createPool = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/v1/pools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          productName,
          regionCode,
          threshold,
          city: city.trim() || undefined,
          // 0 means "unknown" (landed-cost convention) — send null so
          // the pool honestly records "no shipping estimate".
          shippingEstimateUsd: shippingEstimate > 0 ? shippingEstimate : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice(
          res.status === 401
            ? 'Sign in to create a pool.'
            : (data?.error?.message as string) ?? 'Could not create the pool.'
        );
      } else {
        setNotice('Pool created — you are member #1.');
        load();
      }
    } catch {
      setNotice('Could not create the pool.');
    } finally {
      setBusy(false);
    }
  };

  const joinPool = async (poolId: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/v1/pools/${poolId}/join`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setNotice(
          res.status === 401
            ? 'Sign in to join a pool.'
            : (data?.error?.message as string) ?? 'Could not join the pool.'
        );
      } else {
        setNotice('You joined the pool.');
        load();
      }
    } catch {
      setNotice('Could not join the pool.');
    } finally {
      setBusy(false);
    }
  };

  if (!poolsEnabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-5 w-5" /> SmartPool — group buying
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            SmartPools are not live yet — the owner still needs to run supabase/add-smartpools.sql.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-5 w-5" /> SmartPool — group buying ({regionCode})
        </CardTitle>
        <CardDescription>{POOL_NO_GUARANTEE_NOTE}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {pools === null ? (
          <p className="text-sm text-muted-foreground">Loading pools…</p>
        ) : pools.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No open pools for this product yet. Create the first one below.
          </p>
        ) : (
          <ul className="space-y-3">
            {pools.map((p) => {
              const progress = poolProgress(p.memberCount, p.threshold);
              return (
                <li key={p.id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium">{p.product_name}</span>
                    <span className="text-muted-foreground">
                      {progress.members} of {progress.threshold} joined ({progress.percent}%)
                      {p.city ? ` · ${p.city}, ${p.region_code}` : ` · ${p.region_code}`}
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded bg-muted">
                    <div className="h-full bg-primary" style={{ width: `${progress.percent}%` }} />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {progress.reached
                        ? 'Threshold reached — collective interest registered.'
                        : `${progress.remaining} more needed to reach the threshold.`}
                    </span>
                    <Button size="sm" disabled={busy} onClick={() => joinPool(p.id)}>
                      Join pool
                    </Button>
                  </div>
                  <div className="mt-3 space-y-3 border-t pt-3">
                    <PoolMilestones memberCount={progress.members} threshold={progress.threshold} />
                    <PoolShippingSplit
                      shippingEstimateUsd={p.shippingEstimateUsd ?? null}
                      memberCount={progress.members}
                      regionCode={p.region_code}
                      city={p.city ?? null}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <form onSubmit={createPool} className="space-y-3 border-t pt-4">
          <div>
            <Label className="mb-1.5 block">Threshold (members needed)</Label>
            <Input
              type="number"
              min={2}
              max={1000}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
          </div>
          <div>
            <Label className="mb-1.5 block">City (optional — pools are shared per region + city)</Label>
            <Input
              type="text"
              maxLength={100}
              placeholder="e.g. Karachi"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
          </div>
          <div>
            <Label className="mb-1.5 block">
              Estimated total international shipping, USD (optional — your estimate)
            </Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={Number.isFinite(shippingEstimate) ? shippingEstimate : 0}
              onChange={(e) => setShippingEstimate(Math.max(0, Number(e.target.value) || 0))}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Leave 0 when unknown. This is your own estimate, not a carrier quote — members
              split it evenly, and splitting a shipment can increase the total shipping cost.
            </p>
          </div>
          <Button type="submit" disabled={busy}>
            Create a pool for this product
          </Button>
          <p className="text-xs text-muted-foreground">
            Creating or joining a pool requires sign-in. Guests will be asked to{' '}
            <Link href="/sign-in" className="text-primary hover:underline">
              sign in
            </Link>
            .
          </p>
        </form>
        {notice && <p className="text-sm">{notice}</p>}
      </CardContent>
    </Card>
  );
}
