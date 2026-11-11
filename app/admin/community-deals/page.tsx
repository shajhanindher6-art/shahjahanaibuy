/**
 * Admin community-deals moderation page (Section 14, chunk 9) —
 * /admin/community-deals.
 *
 * Lists every community deal (any status) via GET
 * /api/v1/admin/community-deals and moderates via PATCH
 * /api/v1/admin/community-deals/[id] (verify / unverify / reject /
 * approve). Guard: /admin/layout.tsx already redirects non-admins
 * server-side; this page repeats the client-side role check like the
 * merchants page (defense in depth).
 *
 * Honesty: submissions auto-approve today (POST sets
 * status='approved'), so there is no pending queue — moderation here
 * verifies good deals and rejects bad ones. Verification is admin
 * confirmation OR a merchant-price match within 5%; upvotes never
 * verify a deal and never earn points.
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Flag, ShieldCheck, ShieldX } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useAuth } from '@/features/auth';

interface CommunityDealRow {
  id: string;
  author_name: string | null;
  product_name: string;
  merchant_name: string | null;
  price: number | null;
  deal_text: string | null;
  coupon_code: string | null;
  source_url: string | null;
  status: string;
  is_verified: boolean;
  created_at: string;
}

type Action = 'verify' | 'unverify' | 'reject' | 'approve';

export default function AdminCommunityDealsPage() {
  const { user } = useAuth();
  const [deals, setDeals] = useState<CommunityDealRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/v1/admin/community-deals');
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? 'Could not load community deals.');
        setDeals([]);
        return;
      }
      setDeals(Array.isArray(data?.data) ? data.data : []);
    } catch {
      setError('Could not load community deals.');
      setDeals([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function moderate(id: string, action: Action) {
    setBusyId(id);
    setNotice(null);
    try {
      const res = await fetch(`/api/v1/admin/community-deals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setNotice(data?.error?.message ?? 'Moderation failed. Please try again.');
        return;
      }
      setDeals((prev) =>
        prev === null ? prev : prev.map((d) => (d.id === id ? (data.data as CommunityDealRow) : d)),
      );
      setNotice(
        action === 'verify'
          ? 'Deal verified (admin confirmation).'
          : action === 'unverify'
            ? 'Admin verification removed — the deal may still verify by price match.'
            : action === 'reject'
              ? 'Deal rejected — hidden from the public list.'
              : 'Deal approved — visible on the public list again.',
      );
    } catch {
      setNotice('Moderation failed. Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-12">
        <p className="text-muted-foreground">Sign in as an admin to moderate community deals.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mx-auto max-w-2xl">
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <Flag className="h-7 w-7 text-blue-600" /> Community deals moderation
        </h1>
        <p className="mt-2 text-muted-foreground">
          Verify good deals and reject bad ones. Deals are submitted pre-approved today, so
          there is no pending queue — a rejected deal disappears from the public list, and a
          verified deal carries the admin-confirmation badge. Verification is admin
          confirmation or a merchant-price match within 5%; upvotes never verify a deal.
        </p>

        {notice && (
          <p className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100">
            {notice}
          </p>
        )}
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        {deals === null && <LoadingSpinner />}

        {deals !== null && deals.length === 0 && !error && (
          <div className="mt-8 rounded-lg border p-6">
            <p className="font-medium">No community deals yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              No one has submitted a community deal yet. Deals submitted by signed-in members
              will appear here for moderation.
            </p>
          </div>
        )}

        {deals !== null && deals.length > 0 && (
          <div className="mt-8 space-y-4">
            {deals.map((deal) => (
              <Card key={deal.id}>
                <CardHeader>
                  <CardTitle className="text-base">{deal.product_name}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {[deal.merchant_name, deal.price !== null ? `$${deal.price}` : null, deal.author_name]
                      .filter(Boolean)
                      .join(' · ')}
                    {' · '}
                    {new Date(deal.created_at).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={deal.status === 'approved' ? 'default' : 'secondary'}>
                      {deal.status}
                    </Badge>
                    {deal.is_verified ? (
                      <Badge className="bg-green-100 text-green-800">
                        <ShieldCheck className="mr-1 h-3 w-3" /> Verified (admin)
                      </Badge>
                    ) : (
                      <Badge variant="outline">
                        <ShieldX className="mr-1 h-3 w-3" /> Not admin-verified
                      </Badge>
                    )}
                  </div>
                  {deal.deal_text && <p className="text-sm">{deal.deal_text}</p>}
                  {deal.coupon_code && (
                    <p className="text-sm text-muted-foreground">Coupon: {deal.coupon_code}</p>
                  )}
                  {deal.source_url && (
                    <a
                      href={deal.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate text-sm text-blue-600 hover:underline"
                    >
                      {deal.source_url}
                    </a>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {deal.is_verified ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === deal.id}
                        onClick={() => void moderate(deal.id, 'unverify')}
                      >
                        Remove verification
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        disabled={busyId === deal.id}
                        onClick={() => void moderate(deal.id, 'verify')}
                      >
                        Verify
                      </Button>
                    )}
                    {deal.status === 'approved' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === deal.id}
                        onClick={() => void moderate(deal.id, 'reject')}
                      >
                        Reject (hide)
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === deal.id}
                        onClick={() => void moderate(deal.id, 'approve')}
                      >
                        Approve (restore)
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <p className="mt-8 text-sm text-muted-foreground">
          <Link href="/admin" className="font-medium underline underline-offset-4">
            ← Back to admin
          </Link>
        </p>
      </div>
    </div>
  );
}
