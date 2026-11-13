/**
 * Admin fact-check queue (Section 5 #16).
 *
 * Human review for the deal fact-checking pipeline: automated checks
 * run first (price-match, discount-vs-history, history depth,
 * retailer reliability), then an admin approves, rejects, or takes a
 * deal down. A takedown also deactivates the deal itself the same day.
 *
 * Guard: /admin/layout.tsx already redirects non-admins server-side;
 * this page repeats the client-side role check like the main admin
 * page (defense in depth) and shows "Access Denied" otherwise.
 *
 * Honest empty state: with no queue entries, the page says so — it
 * never invents a queue.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, ShieldAlert, ShieldX, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useAuth } from '@/features/auth';
import { DEAL_VERIFIED_MEANING, DEAL_TAKEDOWN_POLICY } from '@/lib/fact-check';
import { cn } from '@/lib/utils';

interface QueueEntry {
  id: string;
  subjectType: string;
  subjectId: string;
  subjectTitle: string;
  listingPrice: number | null;
  compareAtPrice: number | null;
  checkoutPrice: number | null;
  historyLowest: number | null;
  historyPoints: number | null;
  merchantCaution: boolean;
  checks: Array<{ key: string; label: string; outcome: string; detail: string }>;
  overall: 'pass' | 'fail' | 'inconclusive';
  status: 'pending' | 'approved' | 'rejected' | 'taken_down';
  reviewerId: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
}

const OVERALL_BADGE: Record<string, { label: string; className: string }> = {
  pass: { label: 'Checks passed', className: 'border-green-200 bg-green-50 text-green-700' },
  fail: { label: 'Checks failed', className: 'border-red-200 bg-red-50 text-red-700' },
  inconclusive: { label: 'Inconclusive', className: 'border-amber-200 bg-amber-50 text-amber-700' },
};

export default function FactCheckAdminPage() {
  // NOTE (Final 100%, F-P1-62): this page is a client component
  // ('use client'), so it cannot call the server-side
  // requireAdminPage() guard — the /admin layout guard plus the
  // client-side role check below are its guards, exactly as
  // documented in lib/admin-page-guard.ts.
  const { role } = useAuth();
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [deciding, setDeciding] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  // "New check" form (wave 2): creates a check via POST
  // /api/v1/fact-check. Every number is a real observation the admin
  // enters (e.g. read off the deal / retailer page) — nothing here
  // is pre-filled with a price, and the API runs its automated
  // checks over exactly what is submitted.
  const [subjectType, setSubjectType] = useState('deal');
  const [subjectId, setSubjectId] = useState('');
  const [subjectTitle, setSubjectTitle] = useState('');
  const [listingPrice, setListingPrice] = useState('');
  const [compareAtPrice, setCompareAtPrice] = useState('');
  const [checkoutPrice, setCheckoutPrice] = useState('');
  const [historyLowest, setHistoryLowest] = useState('');
  const [historyPoints, setHistoryPoints] = useState('');
  const [merchantCaution, setMerchantCaution] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  async function createCheck() {
    setCreateError(null);
    setCreateSuccess(null);
    const price = Number(listingPrice);
    if (!subjectId.trim() || !subjectTitle.trim()) {
      setCreateError('Subject ID and title are required.');
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      setCreateError('Listing price (a positive number) is required to run the checks.');
      return;
    }
    const optionalNumber = (raw: string): number | undefined => {
      const n = Number(raw);
      return raw.trim() !== '' && Number.isFinite(n) && n > 0 ? n : undefined;
    };
    const points =
      historyPoints.trim() !== '' && Number.isFinite(Number(historyPoints))
        ? Math.max(0, Math.floor(Number(historyPoints)))
        : undefined;
    setCreating(true);
    try {
      const res = await fetch('/api/v1/fact-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectType,
          subjectId: subjectId.trim(),
          subjectTitle: subjectTitle.trim(),
          listingPrice: price,
          compareAtPrice: optionalNumber(compareAtPrice),
          checkoutPrice: optionalNumber(checkoutPrice),
          historyLowest: optionalNumber(historyLowest),
          historyPoints: points,
          merchantCaution,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setCreateError(
          json?.error?.message ??
            (res.status === 409
              ? 'This subject already has a pending fact-check.'
              : 'Failed to create the fact-check.')
        );
        return;
      }
      setCreateSuccess(
        `Check created for "${subjectTitle.trim()}" — overall: ${json.data?.overall ?? 'unknown'}. It is now pending review.`
      );
      setSubjectId('');
      setSubjectTitle('');
      setListingPrice('');
      setCompareAtPrice('');
      setCheckoutPrice('');
      setHistoryLowest('');
      setHistoryPoints('');
      setMerchantCaution(false);
      await fetchQueue();
    } catch {
      setCreateError('Failed to create the fact-check. Please try again.');
    } finally {
      setCreating(false);
    }
  }

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(
        `/api/v1/fact-check${filter === 'pending' ? '?status=pending' : ''}`
      );
      const json = await res.json().catch(() => null);
      if (json?.success) {
        setQueue(json.data?.queue ?? []);
      } else {
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  async function decide(id: string, decision: 'approve' | 'reject' | 'take_down') {
    setDeciding(id);
    setDecisionError(null);
    try {
      const res = await fetch(`/api/v1/fact-check/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note: notes[id]?.trim() || undefined }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setDecisionError(json?.error?.message ?? 'Failed to record the decision.');
        return;
      }
      if (decision === 'take_down' && json.data?.takedownApplied === false) {
        setDecisionError(
          'Decision recorded, but the deal itself could not be deactivated automatically — please deactivate it manually.'
        );
      }
      await fetchQueue();
    } catch {
      setDecisionError('Failed to record the decision. Please try again.');
    } finally {
      setDeciding(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (role !== 'admin') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-bold">Access Denied</h1>
        <p className="text-muted-foreground">You need admin privileges to access this page.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <div className="container mx-auto max-w-7xl px-4 py-8">
        <div className="mb-8">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <ShieldCheck className="h-8 w-8 text-blue-600" />
            Deal Fact-Checking
          </h1>
          <p className="mt-2 text-muted-foreground">
            Automated checks first, human review second. A deal is only &ldquo;Verified&rdquo; after
            both pass — and a failed deal is taken down the same day.
          </p>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">What &ldquo;Verified&rdquo; means (public text)</CardTitle>
            <CardDescription>
              This is the exact text shoppers see. Nothing here promises a live price or a
              guarantee.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>{DEAL_VERIFIED_MEANING}</p>
            <p>{DEAL_TAKEDOWN_POLICY}</p>
          </CardContent>
        </Card>

        <div className="mb-4 flex gap-2">
          <Button
            variant={filter === 'pending' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('pending')}
          >
            Pending
          </Button>
          <Button
            variant={filter === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('all')}
          >
            All entries
          </Button>
        </div>

        {/* New check — POST /api/v1/fact-check. The numbers must come
            from real observations (deal page / retailer checkout /
            recorded history); a check with no usable data is
            "inconclusive", never "passed". */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">New check</CardTitle>
            <CardDescription>
              Run the automated checks on a deal, community deal, product, or manual subject.
              Enter only prices you actually observed — listing price is required; the rest are
              optional and left blank when unknown.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <label htmlFor="fc-subject-type" className="text-sm font-medium">
                  Subject type
                </label>
                <select
                  id="fc-subject-type"
                  value={subjectType}
                  onChange={(e) => setSubjectType(e.target.value)}
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="deal">Deal</option>
                  <option value="community_deal">Community deal</option>
                  <option value="product">Product</option>
                  <option value="manual">Manual</option>
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="fc-subject-id" className="text-sm font-medium">
                  Subject ID
                </label>
                <Input
                  id="fc-subject-id"
                  value={subjectId}
                  onChange={(e) => setSubjectId(e.target.value)}
                  placeholder="Deal or product UUID"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="fc-subject-title" className="text-sm font-medium">
                  Subject title
                </label>
                <Input
                  id="fc-subject-title"
                  value={subjectTitle}
                  onChange={(e) => setSubjectTitle(e.target.value)}
                  placeholder="e.g. MacBook Air 13 — 10% off"
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <div className="space-y-2">
                <label htmlFor="fc-listing-price" className="text-sm font-medium">
                  Listing price (USD) *
                </label>
                <Input
                  id="fc-listing-price"
                  inputMode="decimal"
                  value={listingPrice}
                  onChange={(e) => setListingPrice(e.target.value)}
                  placeholder="999"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="fc-compare-price" className="text-sm font-medium">
                  Compare-at price (USD)
                </label>
                <Input
                  id="fc-compare-price"
                  inputMode="decimal"
                  value={compareAtPrice}
                  onChange={(e) => setCompareAtPrice(e.target.value)}
                  placeholder="1099"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="fc-checkout-price" className="text-sm font-medium">
                  Checkout price (USD)
                </label>
                <Input
                  id="fc-checkout-price"
                  inputMode="decimal"
                  value={checkoutPrice}
                  onChange={(e) => setCheckoutPrice(e.target.value)}
                  placeholder="999"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="fc-history-lowest" className="text-sm font-medium">
                  Recent lowest (USD)
                </label>
                <Input
                  id="fc-history-lowest"
                  inputMode="decimal"
                  value={historyLowest}
                  onChange={(e) => setHistoryLowest(e.target.value)}
                  placeholder="949"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="fc-history-points" className="text-sm font-medium">
                  History points
                </label>
                <Input
                  id="fc-history-points"
                  inputMode="numeric"
                  value={historyPoints}
                  onChange={(e) => setHistoryPoints(e.target.value)}
                  placeholder="30"
                />
              </div>
            </div>
            <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={merchantCaution}
                onChange={(e) => setMerchantCaution(e.target.checked)}
                className="h-4 w-4"
              />
              Retailer carries a Caution flag
            </label>
            {createError && <p className="text-sm text-red-600">{createError}</p>}
            {createSuccess && <p className="text-sm text-green-700">{createSuccess}</p>}
            <Button onClick={() => void createCheck()} disabled={creating} className="min-h-[44px]">
              {creating ? 'Creating…' : 'Create check'}
            </Button>
          </CardContent>
        </Card>

        {decisionError && (
          <p className="mb-4 text-sm text-red-600">{decisionError}</p>
        )}

        {loadError ? (
          <Card>
            <CardContent className="p-6">
              <p className="text-sm text-muted-foreground">
                Could not load the fact-check queue. If migration 028 has not been run yet, the
                queue does not exist — run the migration, then reload.
              </p>
            </CardContent>
          </Card>
        ) : queue.length === 0 ? (
          <Card>
            <CardContent className="p-6">
              <p className="text-sm text-muted-foreground">
                {filter === 'pending'
                  ? 'No deals waiting for review. The queue is empty — nothing is pending, and nothing has been invented to fill it.'
                  : 'No fact-check entries yet. Create one from a real deal (see the API: POST /api/v1/fact-check) and it will appear here.'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {queue.map((entry) => {
              const overall = OVERALL_BADGE[entry.overall] ?? OVERALL_BADGE.inconclusive;
              const isPending = entry.status === 'pending';
              return (
                <Card key={entry.id}>
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-base">{entry.subjectTitle}</CardTitle>
                        <CardDescription>
                          {entry.subjectType} · {entry.subjectId.slice(0, 8)}… · submitted{' '}
                          {new Date(entry.createdAt).toLocaleString()}
                        </CardDescription>
                      </div>
                      <div className="flex gap-2">
                        <Badge variant="secondary" className={cn('text-xs', overall.className)}>
                          {overall.label}
                        </Badge>
                        <Badge variant={isPending ? 'outline' : 'secondary'}>
                          {entry.status === 'pending' ? (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" /> Pending
                            </span>
                          ) : (
                            entry.status.replace('_', ' ')
                          )}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <p className="text-muted-foreground">
                      Listing{' '}
                      {entry.listingPrice !== null ? `$${entry.listingPrice}` : '—'}
                      {entry.compareAtPrice !== null && ` · compare-at $${entry.compareAtPrice}`}
                      {entry.checkoutPrice !== null && ` · checkout $${entry.checkoutPrice}`}
                      {entry.historyLowest !== null &&
                        ` · recent lowest $${entry.historyLowest} (${entry.historyPoints ?? 0} points)`}
                      {entry.merchantCaution && ' · retailer carries a Caution flag'}
                    </p>

                    <ul className="space-y-1">
                      {entry.checks.map((c) => (
                        <li key={c.key} className="flex gap-2">
                          {c.outcome === 'pass' ? (
                            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                          ) : c.outcome === 'fail' ? (
                            <ShieldX className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                          ) : (
                            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                          )}
                          <span>
                            <span className="font-medium">{c.label}:</span>{' '}
                            <span className="text-muted-foreground">{c.detail}</span>
                          </span>
                        </li>
                      ))}
                    </ul>

                    {entry.reviewNote && (
                      <p className="text-muted-foreground">
                        Reviewer note: {entry.reviewNote}
                        {entry.reviewedAt && ` (${new Date(entry.reviewedAt).toLocaleString()})`}
                      </p>
                    )}

                    {isPending && (
                      <div className="space-y-2 pt-1">
                        <Input
                          placeholder="Review note (optional, shown to other admins)"
                          value={notes[entry.id] ?? ''}
                          onChange={(e) =>
                            setNotes((prev) => ({ ...prev, [entry.id]: e.target.value }))
                          }
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            disabled={deciding === entry.id}
                            onClick={() => decide(entry.id, 'approve')}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={deciding === entry.id}
                            onClick={() => decide(entry.id, 'reject')}
                          >
                            Reject
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={deciding === entry.id}
                            onClick={() => decide(entry.id, 'take_down')}
                          >
                            {deciding === entry.id ? 'Working…' : 'Take down'}
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
