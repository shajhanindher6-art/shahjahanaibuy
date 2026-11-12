/**
 * AI "Future You" Planner — /tools/future-you-planner (Section 7,
 * item 20; spec item 13 in the Section 7 combined batch).
 *
 * A savings plan for a big purchase: set a target + date, and the
 * planner says how much to save each month — computed at read time
 * as (target − saved so far) ÷ months remaining. When a goal names
 * a product, its current recorded price and alert status are shown,
 * so the user can set a price-drop alert and be told when the deal
 * arrives. Client page: fetches GET /api/v1/tools/future-you and
 * creates via POST; the "already saved" preview is computed locally
 * with the same lib function and is never stored.
 */

'use client';

import { useRegion } from '@/components/region/region-provider';
import { tFor } from '@/lib/i18n';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Target } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { planFutureYou, type FutureYouPlan } from '@/lib/future-you';

interface Goal {
  id: string;
  name: string;
  targetUsd: number;
  targetDate: string;
  productSlug: string | null;
  savedSoFarUsd: number;
  plan: FutureYouPlan;
  product: {
    name: string;
    slug: string;
    currentPriceUsd: number | null;
    hasActiveAlert: boolean;
  } | null;
}

interface FutureYouResponse {
  goals: Goal[];
  futureYouEnabled: boolean;
}

export default function FutureYouPlannerPage() {
  const { language } = useRegion();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(true);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [targetInput, setTargetInput] = useState('');
  const [dateInput, setDateInput] = useState('');
  const [slugInput, setSlugInput] = useState('');
  const [savedInput, setSavedInput] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/tools/future-you');
      if (res.status === 401) {
        setSignedIn(false);
        setGoals([]);
        return;
      }
      if (!res.ok) throw new Error('future-you request failed');
      const json = await res.json();
      setSignedIn(true);
      setGoals((json?.data as FutureYouResponse)?.goals ?? []);
      setEnabled((json?.data as FutureYouResponse)?.futureYouEnabled ?? true);
    } catch {
      setGoals([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createGoal() {
    const targetUsd = Number(targetInput);
    if (name.trim().length === 0) {
      setNote('Give the goal a name, e.g. "New phone".');
      return;
    }
    if (!Number.isFinite(targetUsd) || targetUsd <= 0) {
      setNote('Enter a target amount above $0.');
      return;
    }
    if (!dateInput || !Number.isFinite(Date.parse(dateInput))) {
      setNote('Pick a valid target date.');
      return;
    }
    setSaving(true);
    setNote(null);
    try {
      const res = await fetch('/api/v1/tools/future-you', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          target_usd: targetUsd,
          target_date: dateInput,
          product_slug: slugInput.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => null);
      if (res.status === 401) {
        setSignedIn(false);
        setNote('Sign in to create a saving goal.');
        return;
      }
      if (res.status === 503) {
        setNote(json?.error?.message ?? 'Future You planner is not set up yet.');
        return;
      }
      if (!res.ok) {
        setNote(json?.error?.message ?? 'Could not create the goal.');
        return;
      }
      setName('');
      setTargetInput('');
      setDateInput('');
      setSlugInput('');
      setNote('Goal saved.');
      await load();
    } catch {
      setNote('Could not reach the server — try again.');
    } finally {
      setSaving(false);
    }
  }

  // Preview: what the monthly amount would be with the user's own
  // already-saved figure — computed locally, never stored.
  const preview =
    Number.isFinite(Number(targetInput)) && Number(targetInput) > 0 && dateInput
      ? planFutureYou({
          targetUsd: Number(targetInput),
          savedSoFarUsd: Number.isFinite(Number(savedInput)) ? Math.max(0, Number(savedInput)) : 0,
          targetDate: dateInput,
        })
      : null;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Target className="h-7 w-7 text-blue-600" /> {tFor(language, 'toolHeadingFutureYou')}
          </h1>
          <p className="mt-2 text-muted-foreground">
            Saving for a big purchase? Set the target and the date, and the
            planner says how much to save each month: (target − saved so
            far) ÷ months remaining. Link a product and its current
            recorded price and alert status are shown — set a price-drop
            alert on the product page and you will be told when the deal
            arrives. The monthly amount is computed with a fixed formula
            from your target and date — no LLM, nothing guessed.
          </p>

          {!signedIn ? (
            <Card className="mt-8">
              <CardContent className="pt-6">
                <p className="font-medium">Sign in to plan your savings.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Saving goals are kept in your account.
                </p>
                <Link
                  href="/sign-in"
                  className="mt-4 inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                >
                  Sign in →
                </Link>
              </CardContent>
            </Card>
          ) : loading ? (
            <div className="mt-8 flex justify-center">
              <LoadingSpinner />
            </div>
          ) : (
            <>
              <Card className="mt-8">
                <CardHeader>
                  <CardTitle className="text-base">New saving goal</CardTitle>
                  <CardDescription>
                    The monthly amount is always computed from the target
                    and the date — it is never stored.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="fy-name">Goal name</Label>
                    <Input
                      id="fy-name"
                      type="text"
                      placeholder="New phone"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="fy-target">Target amount (USD)</Label>
                      <Input
                        id="fy-target"
                        type="number"
                        min={1}
                        step={10}
                        value={targetInput}
                        onChange={(e) => setTargetInput(e.target.value)}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="fy-date">Target date</Label>
                      <Input
                        id="fy-date"
                        type="date"
                        value={dateInput}
                        onChange={(e) => setDateInput(e.target.value)}
                        className="mt-1"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="fy-slug">Product slug (optional)</Label>
                      <Input
                        id="fy-slug"
                        type="text"
                        placeholder="macbook-pro-14-m4"
                        value={slugInput}
                        onChange={(e) => setSlugInput(e.target.value)}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="fy-saved">Already saved (USD, preview only)</Label>
                      <Input
                        id="fy-saved"
                        type="number"
                        min={0}
                        step={10}
                        value={savedInput}
                        onChange={(e) => setSavedInput(e.target.value)}
                        className="mt-1"
                      />
                    </div>
                  </div>
                  {preview && (
                    <p className="rounded-md bg-slate-50 px-3 py-2 text-sm">
                      Preview: {preview.message}
                    </p>
                  )}
                  <Button onClick={createGoal} disabled={saving}>
                    {saving ? 'Saving goal…' : 'Save goal'}
                  </Button>
                  {note && <p className="text-sm text-muted-foreground">{note}</p>}
                </CardContent>
              </Card>

              {!enabled ? (
                <EmptyState
                  title="Future You planner is not set up yet"
                  description="The saving-goals table is not in the database yet. Goals will appear here once the Section 7 migration has been run — nothing is planned until then."
                />
              ) : goals.length === 0 ? (
                <EmptyState
                  title="No saving goals yet"
                  description="Create your first goal above — a target amount and a date are all it takes to get a monthly saving plan."
                />
              ) : (
                <div className="mt-8 space-y-4">
                  {goals.map((goal) => (
                    <article key={goal.id} className="rounded-lg border p-4">
                      <div className="flex items-center justify-between gap-2">
                        <h2 className="font-semibold">{goal.name}</h2>
                        <Badge variant={goal.plan.status === 'on_track' ? 'default' : 'secondary'}>
                          {goal.plan.status === 'on_track'
                            ? 'On track'
                            : goal.plan.status === 'date_passed'
                              ? 'Date passed'
                              : goal.plan.status === 'already_saved'
                                ? 'Target reached'
                                : goal.plan.status === 'unrealistic'
                                  ? 'Unrealistic'
                                  : 'Invalid'}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Target ${goal.targetUsd.toLocaleString()} by{' '}
                        {new Date(goal.targetDate).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </p>
                      <p className="mt-2 text-sm font-medium">
                        {goal.plan.monthlySavingUsd !== null
                          ? `Save $${goal.plan.monthlySavingUsd.toFixed(2)} per month`
                          : 'No monthly amount — see below'}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">{goal.plan.message}</p>
                      {goal.product ? (
                        <p className="mt-2 text-sm text-muted-foreground">
                          <Link href={`/products/${goal.product.slug}`} className="underline-offset-4 hover:underline">
                            {goal.product.name}
                          </Link>
                          {': '}
                          {goal.product.currentPriceUsd !== null
                            ? `current recorded price $${goal.product.currentPriceUsd.toFixed(2)}. `
                            : 'no recorded price yet. '}
                          {goal.product.hasActiveAlert
                            ? 'You have an active price-drop alert for this product.'
                            : 'No active alert for this product — set one on the product page to be told when the deal arrives.'}
                        </p>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
