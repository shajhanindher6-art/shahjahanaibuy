/**
 * AI Subscription Manager — Section 7, item 3.
 *
 * Client page: the user's own consumer subscriptions (Netflix,
 * Spotify, …) in one place — renewal reminders, duplicate / overlap
 * flags, rarely-used flags, and the total monthly cost (yearly
 * prices converted to monthly). Cheaper alternatives are only ever
 * shown from real recorded data: none is recorded here, so none is
 * ever suggested — the page says so honestly instead of inventing
 * one. This is NOT the SmartBuy Premium plan page; that lives in
 * the Stripe subscriptions API and is untouched by this feature.
 *
 * A failed fetch shows an honest empty state, never invented
 * subscriptions or prices.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ConsumerSubscription } from '@/lib/subscription-manager';

interface EnrichedSubscription extends ConsumerSubscription {
  monthlyUsd: number;
  renewal: 'overdue' | 'due-soon' | 'upcoming' | 'no-date';
}

interface SubscriptionsResponse {
  subscriptions: EnrichedSubscription[];
  totalMonthlyUsd: number;
  reminders: ConsumerSubscription[];
  overlaps: Array<{ normalizedName: string; subscriptions: ConsumerSubscription[] }>;
  rarelyUsedIds: string[];
  subscriptionsEnabled: boolean;
}

function daysLabel(renewalDate: string | null): string {
  if (!renewalDate) return 'No renewal date recorded';
  const renewal = new Date(`${renewalDate}T00:00:00Z`);
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const diffDays = Math.round((renewal.getTime() - todayUtc.getTime()) / 86_400_000);
  if (diffDays < 0) return `Renewal was ${-diffDays} day${-diffDays === 1 ? '' : 's'} ago`;
  if (diffDays === 0) return 'Renews today';
  if (diffDays === 1) return 'Renews tomorrow';
  return `Renews in ${diffDays} days`;
}

export default function SubscriptionManagerPage() {
  const [subscriptions, setSubscriptions] = useState<EnrichedSubscription[]>([]);
  const [totalMonthlyUsd, setTotalMonthlyUsd] = useState(0);
  const [reminders, setReminders] = useState<ConsumerSubscription[]>([]);
  const [overlaps, setOverlaps] = useState<SubscriptionsResponse['overlaps']>([]);
  const [rarelyUsedIds, setRarelyUsedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);
  const [subscriptionsEnabled, setSubscriptionsEnabled] = useState(true);

  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'yearly'>('monthly');
  const [renewalDate, setRenewalDate] = useState('');
  const [category, setCategory] = useState('');
  const [lastUsedAt, setLastUsedAt] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formOk, setFormOk] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch('/api/v1/tools/consumer-subscriptions');
      const json = await res.json().catch(() => null);
      if (res.status === 401) {
        setUnauthorized(true);
        return;
      }
      setUnauthorized(false);
      if (res.ok && json?.success && json.data) {
        const data = json.data as SubscriptionsResponse;
        setSubscriptions(data.subscriptions);
        setTotalMonthlyUsd(data.totalMonthlyUsd);
        setReminders(data.reminders);
        setOverlaps(data.overlaps);
        setRarelyUsedIds(data.rarelyUsedIds);
        setSubscriptionsEnabled(data.subscriptionsEnabled !== false);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function resetForm() {
    setName('');
    setPrice('');
    setBillingInterval('monthly');
    setRenewalDate('');
    setCategory('');
    setLastUsedAt('');
    setEditingId(null);
  }

  function startEdit(sub: EnrichedSubscription) {
    setEditingId(sub.id);
    setName(sub.name);
    setPrice(String(sub.priceUsd));
    setBillingInterval(sub.billingInterval);
    setRenewalDate(sub.renewalDate ?? '');
    setCategory(sub.category ?? '');
    setLastUsedAt(sub.lastUsedAt ?? '');
    setFormError(null);
    setFormOk(false);
  }

  async function submitSubscription(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormOk(false);
    const priceUsd = parseFloat(price);
    if (name.trim() === '') {
      setFormError('Enter the subscription name.');
      return;
    }
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
      setFormError('Enter a price greater than 0.');
      return;
    }
    setSaving(true);
    try {
      const body = {
        ...(editingId ? { id: editingId } : {}),
        name: name.trim(),
        price_usd: priceUsd,
        billing_interval: billingInterval,
        renewal_date: renewalDate === '' ? null : renewalDate,
        category: category.trim() === '' ? null : category.trim(),
        last_used_at: lastUsedAt === '' ? null : lastUsedAt,
      };
      const res = await fetch('/api/v1/tools/consumer-subscriptions', {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        resetForm();
        setFormOk(true);
        await load();
      } else if (res.status === 401) {
        setFormError('Sign in to save a subscription.');
      } else {
        setFormError(
          json?.error?.message ?? 'Could not save the subscription. Try again.'
        );
      }
    } catch {
      setFormError('Could not save the subscription. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteSubscription(id: string, subName: string) {
    if (!window.confirm(`Remove ${subName}? This cannot be undone.`)) return;
    setFormError(null);
    try {
      const res = await fetch(`/api/v1/tools/consumer-subscriptions?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        await load();
      } else if (res.status === 401) {
        setFormError('Sign in to manage subscriptions.');
      } else {
        setFormError(json?.error?.message ?? 'Could not remove the subscription. Try again.');
      }
    } catch {
      setFormError('Could not remove the subscription. Try again.');
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-bold">Subscription manager</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your consumer subscriptions — streaming, apps, services — in one
          place, with renewal reminders and flags for duplicates and
          subscriptions you rarely use. Cheaper alternatives are only
          suggested from real recorded prices: none is recorded, so none
          is suggested here — never a made-up price. Reminders and
          duplicate flags are computed with deterministic rules from the
          subscriptions you record — no LLM, nothing guessed.
        </p>

        {!subscriptionsEnabled && (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Subscription tracking is not live yet — the owner still needs
            to run the migration once. Until then, no subscriptions can
            be recorded.
          </p>
        )}

        <form
          className="mt-6 flex flex-wrap items-end gap-3 rounded-lg border p-4"
          onSubmit={submitSubscription}
        >
          <div className="space-y-2">
            <Label htmlFor="subName">Service name</Label>
            <Input
              id="subName"
              placeholder="e.g. Netflix"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="subPrice">Price (USD)</Label>
            <Input
              id="subPrice"
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              placeholder="e.g. 15.49"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="subInterval">Billing</Label>
            <select
              id="subInterval"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={billingInterval}
              onChange={(e) => setBillingInterval(e.target.value as 'monthly' | 'yearly')}
            >
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="subRenewal">Renewal date</Label>
            <Input
              id="subRenewal"
              type="date"
              value={renewalDate}
              onChange={(e) => setRenewalDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="subCategory">Category (optional)</Label>
            <Input
              id="subCategory"
              placeholder="e.g. Streaming"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="subLastUsed">Last used (optional)</Label>
            <Input
              id="subLastUsed"
              type="date"
              value={lastUsedAt}
              onChange={(e) => setLastUsedAt(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={saving || !subscriptionsEnabled}>
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add subscription'}
          </Button>
          {editingId && (
            <Button type="button" variant="outline" onClick={resetForm}>
              Cancel edit
            </Button>
          )}
        </form>
        {formError && <p className="mt-2 text-sm text-red-600">{formError}</p>}
        {formOk && <p className="mt-2 text-sm text-green-700">Subscription saved.</p>}

        <div className="mt-8">
          {loading ? (
            <LoadingSpinner />
          ) : unauthorized ? (
            <div>
              <EmptyState
                title="Sign in to manage your subscriptions"
                description="Your subscriptions are private to your account."
              />
              <p className="mt-4 text-sm">
                <Link href="/sign-in" className="underline">
                  Sign in
                </Link>
              </p>
            </div>
          ) : failed ? (
            <EmptyState
              title="Subscriptions could not be loaded"
              description="Try again later. No subscriptions or totals are shown rather than guessed ones."
            />
          ) : (
            <>
              <h2 className="text-lg font-semibold">
                Total: ${totalMonthlyUsd.toFixed(2)}/month
                {subscriptions.filter((s) => s.isActive).length > 0 &&
                  ` across ${subscriptions.filter((s) => s.isActive).length} active subscription${subscriptions.filter((s) => s.isActive).length === 1 ? '' : 's'}`}
              </h2>

              {reminders.length > 0 && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  <p className="font-semibold">Renewal reminders</p>
                  <ul className="mt-1 list-disc pl-5">
                    {reminders.map((sub) => (
                      <li key={sub.id}>
                        {sub.name} — {daysLabel(sub.renewalDate)} (${sub.priceUsd.toFixed(2)}/
                        {sub.billingInterval === 'yearly' ? 'year' : 'month'})
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {overlaps.length > 0 && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
                  <p className="font-semibold">Possible duplicates — you may be paying twice</p>
                  <ul className="mt-1 list-disc pl-5">
                    {overlaps.map((group) => (
                      <li key={group.normalizedName}>
                        {group.subscriptions.map((s) => s.name).join(' / ')} — same service name
                        recorded {group.subscriptions.length} times. Check whether both are
                        really needed.
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {subscriptions.length === 0 ? (
                <div className="mt-6">
                  <EmptyState
                    title="No subscriptions recorded yet"
                    description="Add your first subscription above — Netflix, Spotify, or any service you pay for. Renewal reminders and the monthly total appear here once you have recorded one."
                  />
                </div>
              ) : (
                <ul className="mt-6 space-y-3">
                  {subscriptions.map((sub) => (
                    <li key={sub.id} className="rounded-lg border p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold">
                            {sub.name}
                            {sub.category ? (
                              <span className="ml-2 text-sm font-normal text-muted-foreground">
                                {sub.category}
                              </span>
                            ) : null}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            ${sub.priceUsd.toFixed(2)}/
                            {sub.billingInterval === 'yearly' ? 'year' : 'month'} · $
                            {sub.monthlyUsd.toFixed(2)}/month · {daysLabel(sub.renewalDate)}
                          </p>
                          <div className="mt-1 space-y-0.5 text-sm">
                            {sub.renewal === 'due-soon' && (
                              <p className="font-medium text-amber-700">Renews within 7 days.</p>
                            )}
                            {sub.renewal === 'overdue' && (
                              <p className="font-medium text-red-600">
                                Renewal date has passed — check whether it already renewed.
                              </p>
                            )}
                            {rarelyUsedIds.includes(sub.id) && (
                              <p className="font-medium text-amber-700">
                                Rarely used — not used for over 90 days. Consider cancelling.
                              </p>
                            )}
                            {!sub.isActive && <p className="text-muted-foreground">Inactive.</p>}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => startEdit(sub)}>
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => deleteSubscription(sub.id, sub.name)}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <p className="mt-6 text-sm text-muted-foreground">
                No cheaper alternative is suggested for any subscription above,
                because no cheaper alternative price has been recorded. If a
                real cheaper price is recorded in future, it will be shown
                here — never a made-up one.
              </p>
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
