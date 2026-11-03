'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { poolProgress, POOL_NO_GUARANTEE_NOTE } from '@/services/smartpool';

interface Pool {
  id: string;
  product_id: string | null;
  product_name: string;
  region_code: string;
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
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/pools?productId=${encodeURIComponent(productId)}`);
      const data = await res.json();
      setPools((data?.data ?? []) as Pool[]);
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
        body: JSON.stringify({ productId, productName, regionCode, threshold }),
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
