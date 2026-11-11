/**
 * AI Monthly Shopping Planner — /tools/monthly-planner (Section 7, item 4).
 *
 * Monthly budget + product slugs → a plan built server-side from
 * recorded price history: buy now / wait / next month, each with a
 * reason from the Buy vs Wait engine and the price vs the recorded
 * 30-day low. The budget is a hard filter — a buy-now item that
 * does not fit moves to next month. Client page: fetches
 * GET /api/v1/tools/planner and builds via POST; a failed fetch
 * shows an honest empty state, never an invented plan.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarRange } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';

type PlanDecision = 'buy_now' | 'wait' | 'next_month';

interface PlanItem {
  id: string;
  product_slug: string;
  decision: PlanDecision;
  reason: string;
}

interface Plan {
  id: string;
  month: string;
  budget_usd: number;
}

interface PlannerResponse {
  plan: Plan | null;
  items: PlanItem[];
  month: string;
  plannerEnabled: boolean;
  buyNowTotalUsd?: number;
  waitTotalUsd?: number;
  nextMonthTotalUsd?: number;
  remainingBudgetUsd?: number;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const DECISION_LABEL: Record<PlanDecision, string> = {
  buy_now: 'Buy now',
  wait: 'Wait',
  next_month: 'Next month',
};

const DECISION_VARIANT: Record<PlanDecision, 'default' | 'secondary' | 'outline'> = {
  buy_now: 'default',
  wait: 'secondary',
  next_month: 'outline',
};

export default function MonthlyPlannerPage() {
  const [month, setMonth] = useState(currentMonth());
  const [budgetInput, setBudgetInput] = useState('300');
  const [slugsInput, setSlugsInput] = useState('');
  const [data, setData] = useState<PlannerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signedIn, setSignedIn] = useState(true);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async (targetMonth: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/tools/planner?month=${encodeURIComponent(targetMonth)}`);
      if (res.status === 401) {
        setSignedIn(false);
        setData(null);
        return;
      }
      if (!res.ok) throw new Error('planner request failed');
      const json = await res.json();
      setSignedIn(true);
      setData(json?.data as PlannerResponse);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(month);
  }, [load, month]);

  async function buildPlan() {
    const budget = Number(budgetInput);
    const slugs = slugsInput
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!Number.isFinite(budget) || budget <= 0) {
      setNote('Enter a monthly budget above $0.');
      return;
    }
    if (slugs.length === 0) {
      setNote('Enter at least one product slug — the slug from a product page URL, e.g. macbook-pro-14-m4.');
      return;
    }
    setSaving(true);
    setNote(null);
    try {
      const res = await fetch('/api/v1/tools/planner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, budget_usd: budget, product_slugs: slugs }),
      });
      const json = await res.json().catch(() => null);
      if (res.status === 401) {
        setSignedIn(false);
        setNote('Sign in to build a monthly plan.');
        return;
      }
      if (res.status === 503) {
        setNote(json?.error?.message ?? 'Monthly planner is not set up yet.');
        return;
      }
      if (!res.ok) {
        setNote(json?.error?.message ?? 'Could not build the plan.');
        return;
      }
      setData(json?.data as PlannerResponse);
      setNote('Plan saved for this month.');
    } catch {
      setNote('Could not reach the server — try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <CalendarRange className="h-7 w-7 text-blue-600" /> Monthly shopping planner
          </h1>
          <p className="mt-2 text-muted-foreground">
            Set a monthly budget and the products you are considering. The
            planner uses the Buy vs Wait engine on recorded price history —
            buy now, wait for a drop, or move it to next month — and the
            budget is a hard limit: a buy-now item that does not fit moves
            to next month. Nothing here is a price forecast. Buy, wait and
            move-to-next-month calls are deterministic rules on recorded
            price history — no LLM, nothing guessed.
          </p>

          {!signedIn ? (
            <Card className="mt-8">
              <CardContent className="pt-6">
                <p className="font-medium">Sign in to build a monthly plan.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Plans are saved in your account. Your budget and product
                  choices stay yours — nothing is shared.
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
                  <CardTitle className="text-base">Build this month&apos;s plan</CardTitle>
                  <CardDescription>
                    Decisions are computed from recorded prices — never from
                    what you type here.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="planner-month">Month</Label>
                      <Input
                        id="planner-month"
                        type="month"
                        value={month}
                        onChange={(e) => setMonth(e.target.value || currentMonth())}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="planner-budget">Monthly budget (USD)</Label>
                      <Input
                        id="planner-budget"
                        type="number"
                        min={1}
                        step={10}
                        value={budgetInput}
                        onChange={(e) => setBudgetInput(e.target.value)}
                        className="mt-1"
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="planner-slugs">Product slugs (comma-separated)</Label>
                    <Input
                      id="planner-slugs"
                      type="text"
                      placeholder="macbook-pro-14-m4, dell-xps-13"
                      value={slugsInput}
                      onChange={(e) => setSlugsInput(e.target.value)}
                      className="mt-1"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      The slug is the last part of a product page URL.
                    </p>
                  </div>
                  <Button onClick={buildPlan} disabled={saving}>
                    {saving ? 'Building plan…' : 'Build plan'}
                  </Button>
                  {note && <p className="text-sm text-muted-foreground">{note}</p>}
                </CardContent>
              </Card>

              {data && !data.plannerEnabled ? (
                <EmptyState
                  title="Monthly planner is not set up yet"
                  description="The planner tables are not in the database yet. Plans will appear here once the Section 7 migration has been run — nothing is planned until then."
                />
              ) : data?.plan ? (
                <div className="mt-8 space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Budget</p>
                      <p className="text-lg font-bold">${Number(data.plan.budget_usd).toLocaleString()}</p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Buy now</p>
                      <p className="text-lg font-bold">${(data.buyNowTotalUsd ?? 0).toLocaleString()}</p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Wait</p>
                      <p className="text-lg font-bold">${(data.waitTotalUsd ?? 0).toLocaleString()}</p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Remaining</p>
                      <p className="text-lg font-bold">${(data.remainingBudgetUsd ?? 0).toLocaleString()}</p>
                    </div>
                  </div>
                  {data.items.map((item) => (
                    <article key={item.id} className="rounded-lg border p-4">
                      <div className="flex items-center justify-between gap-2">
                        <Link href={`/products/${item.product_slug}`} className="font-medium underline-offset-4 hover:underline">
                          {item.product_slug}
                        </Link>
                        <Badge variant={DECISION_VARIANT[item.decision]}>
                          {DECISION_LABEL[item.decision]}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{item.reason}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No plan for this month yet"
                  description="Build a plan above — set your budget, add product slugs, and the planner will say what to buy now, what to wait for, and what to move to next month."
                />
              )}
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
