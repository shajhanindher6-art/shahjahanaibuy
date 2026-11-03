'use client';

/**
 * Community Deals section (rendered on the deals page).
 *
 * - Lists approved community deals, net-score ranked, with honest
 *   badges: "Community" = submitted by a user; "Verified" ONLY when
 *   the deal's price matches a real merchant listing (computed on
 *   the server — upvotes never verify a deal).
 * - Submit + vote are signed-in only: guests see an honest sign-in
 *   note, never an anonymous form that could be spammed.
 * - If the migration has not been run yet, the API returns
 *   communityEnabled: false and this section says so plainly —
 *   never a crash, never fake deals.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowBigUp, ArrowBigDown, Users, BadgeCheck, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useAuth } from '@/features/auth';
import { Price } from '@/components/region/price';

interface CommunityDeal {
  id: string;
  product_name: string;
  merchant_name: string | null;
  price: number | null;
  deal_text: string | null;
  coupon_code: string | null;
  source_url: string | null;
  netScore: number;
  verified: boolean;
  created_at: string;
}

export function CommunityDeals() {
  const { isAuthenticated } = useAuth();
  const [deals, setDeals] = useState<CommunityDeal[]>([]);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [myVotes, setMyVotes] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formOk, setFormOk] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [form, setForm] = useState({
    productName: '',
    merchantName: '',
    price: '',
    dealText: '',
    couponCode: '',
    sourceUrl: '',
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/community-deals');
      const data = await res.json();
      setEnabled(data?.meta?.communityEnabled === true);
      setDeals(Array.isArray(data.data) ? data.data : []);
    } catch {
      setEnabled(false);
      setDeals([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function vote(dealId: string, value: 1 | -1) {
    const next = myVotes[dealId] === value ? 0 : value;
    const res = await fetch(`/api/v1/community-deals/${dealId}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: next }),
    });
    if (!res.ok) return;
    setMyVotes((prev) => ({ ...prev, [dealId]: next }));
    await load();
  }

  async function submit() {
    setFormError(null);
    setFormOk(false);
    if (!form.productName.trim()) {
      setFormError('Enter the product name.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/v1/community-deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName: form.productName.trim(),
          merchantName: form.merchantName.trim() || null,
          price: form.price ? Number(form.price) : null,
          dealText: form.dealText.trim() || null,
          couponCode: form.couponCode.trim() || null,
          sourceUrl: form.sourceUrl.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data?.error ?? 'Could not submit this deal.');
        return;
      }
      setFormOk(true);
      setForm({ productName: '', merchantName: '', price: '', dealText: '', couponCode: '', sourceUrl: '' });
      await load();
    } catch {
      setFormError('Could not submit this deal. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Clipboard blocked: code stays visible for manual copy.
    }
    setCopied(code);
    window.setTimeout(() => setCopied(null), 2000);
  }

  return (
    <section className="mt-12 space-y-4">
      <h2 className="flex items-center gap-2 text-xl font-bold">
        <Users className="h-5 w-5 text-blue-600" /> Community Deals
      </h2>
      <p className="text-sm text-muted-foreground">
        Deals shared by shoppers, ranked by community votes. &ldquo;Verified&rdquo; means the deal
        price matches a real merchant listing — votes alone never earn that badge.
      </p>

      {loading && <LoadingSpinner />}
      {!loading && enabled === false && (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            Community deals are not live yet — the site owner still needs to run
            <code> supabase/add-community-deals.sql </code>
            once. Until then, no community deals are shown rather than fake ones.
          </CardContent>
        </Card>
      )}
      {!loading && enabled === true && deals.length === 0 && (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            No community deals yet. Be the first to share one below — it will show here with a
            Community badge.
          </CardContent>
        </Card>
      )}

      {deals.map((deal) => (
        <Card key={deal.id}>
          <CardContent className="flex gap-3 p-4">
            <div className="flex flex-col items-center gap-1">
              <button
                aria-label="Upvote"
                disabled={!isAuthenticated}
                onClick={() => vote(deal.id, 1)}
                className={myVotes[deal.id] === 1 ? 'text-green-600' : 'text-muted-foreground'}
              >
                <ArrowBigUp className="h-5 w-5" />
              </button>
              <span className="text-sm font-bold">{deal.netScore}</span>
              <button
                aria-label="Downvote"
                disabled={!isAuthenticated}
                onClick={() => vote(deal.id, -1)}
                className={myVotes[deal.id] === -1 ? 'text-red-600' : 'text-muted-foreground'}
              >
                <ArrowBigDown className="h-5 w-5" />
              </button>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{deal.product_name}</p>
                <Badge variant="secondary">Community</Badge>
                {deal.verified && (
                  <Badge className="gap-1 bg-green-100 text-green-800">
                    <BadgeCheck className="h-3 w-3" /> Verified
                  </Badge>
                )}
              </div>
              {deal.merchant_name && <p className="text-sm text-muted-foreground">{deal.merchant_name}</p>}
              {deal.deal_text && <p className="mt-1 text-sm">{deal.deal_text}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {deal.price !== null && <Price usd={deal.price} className="font-bold text-blue-600" />}
                {deal.coupon_code && (
                  <button
                    onClick={() => copyCode(deal.coupon_code as string)}
                    className="flex items-center gap-1 rounded-md border border-dashed px-2 py-1 font-mono text-sm font-bold"
                  >
                    {deal.coupon_code}
                    {copied === deal.coupon_code ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                )}
                {deal.source_url && (
                  <a className="text-sm text-blue-600 underline" href={deal.source_url} target="_blank" rel="noopener noreferrer">
                    Source
                  </a>
                )}
              </div>
              {!isAuthenticated && (
                <p className="mt-2 text-xs text-muted-foreground">
                  <Link className="text-blue-600 underline" href="/sign-in">
                    Sign in
                  </Link>{' '}
                  to vote on community deals.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Share a deal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!isAuthenticated ? (
            <p className="text-sm text-muted-foreground">
              Sharing is signed-in only (to keep spam out).{' '}
              <Link className="text-blue-600 underline" href="/sign-in">
                Sign in
              </Link>{' '}
              to share a deal you found.
            </p>
          ) : enabled === false ? (
            <p className="text-sm text-muted-foreground">
              Sharing activates once the site owner runs the community-deals migration (see note above).
            </p>
          ) : (
            <>
              <Input
                placeholder="Product name *"
                value={form.productName}
                onChange={(e) => setForm({ ...form, productName: e.target.value })}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  placeholder="Merchant (e.g. Amazon)"
                  value={form.merchantName}
                  onChange={(e) => setForm({ ...form, merchantName: e.target.value })}
                />
                <Input
                  placeholder="Price in USD (optional)"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </div>
              <Input
                placeholder="What is the deal? (optional)"
                value={form.dealText}
                onChange={(e) => setForm({ ...form, dealText: e.target.value })}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  placeholder="Coupon code (optional)"
                  value={form.couponCode}
                  onChange={(e) => setForm({ ...form, couponCode: e.target.value })}
                />
                <Input
                  placeholder="Source URL (optional)"
                  value={form.sourceUrl}
                  onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
                />
              </div>
              {formError && <p className="text-sm text-red-600">{formError}</p>}
              {formOk && <p className="text-sm text-green-700">Deal shared — it now shows above with a Community badge.</p>}
              <Button onClick={submit} disabled={submitting}>
                {submitting ? 'Sharing…' : 'Share deal'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
