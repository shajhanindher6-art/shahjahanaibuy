/**
 * AI Eco Shopping Coach — /tools/eco-coach (Section 7, item 15).
 *
 * Client page: fetches GET /api/v1/tools/eco-coach. Set a monthly
 * carbon budget, see the month's spend (recorded carbon and
 * estimates reported separately), and ask the coach about one
 * product. Recorded carbon comes first; an estimate is always
 * labeled "Estimate only — not a certified lifecycle assessment";
 * lower-carbon alternatives are real catalog products with lower
 * recorded carbon.
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
import type {
  BudgetStatus,
  EcoBudget,
  MonthlyCarbonSpend,
} from '@/lib/eco-coach';
import type { CoachNoteResult } from '@/lib/eco-coach';

interface EcoCoachResponse {
  month: string;
  budget: EcoBudget | null;
  spend: MonthlyCarbonSpend;
  budgetStatus: BudgetStatus | null;
  coachNote: CoachNoteResult | null;
  budgetEnabled?: boolean;
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export default function EcoCoachPage() {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<EcoCoachResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);
  const [budgetEnabled, setBudgetEnabled] = useState(true);
  const [budgetInput, setBudgetInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [productSlug, setProductSlug] = useState('');
  const [coachLoading, setCoachLoading] = useState(false);

  const load = useCallback(async (m: string, slug?: string) => {
    setLoading(true);
    setFailed(false);
    setUnauthorized(false);
    try {
      const params = new URLSearchParams({ month: m });
      if (slug) params.set('productSlug', slug);
      const res = await fetch(`/api/v1/tools/eco-coach?${params.toString()}`);
      const json = await res.json().catch(() => null);
      if (res.status === 401) {
        setUnauthorized(true);
      } else if (res.ok && json?.success) {
        setData(json.data as EcoCoachResponse);
        setBudgetEnabled(json.meta?.budgetEnabled !== false);
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
    load(month);
  }, [month, load]);

  useEffect(() => {
    if (data?.budget) setBudgetInput(String(data.budget.budget_kg));
  }, [data?.budget]);

  async function saveBudget(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/v1/tools/eco-coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, budgetKg: Number(budgetInput) }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        setMessage('Carbon budget saved.');
        await load(month, productSlug || undefined);
      } else {
        setMessage(json?.error?.message ?? 'Could not save the budget. Try again later.');
      }
    } catch {
      setMessage('Could not save the budget. Try again later.');
    } finally {
      setSaving(false);
    }
  }

  async function askCoach(e: React.FormEvent) {
    e.preventDefault();
    if (!productSlug.trim()) return;
    setCoachLoading(true);
    await load(month, productSlug.trim());
    setCoachLoading(false);
  }

  const spend = data?.spend;
  const status = data?.budgetStatus;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-bold">AI Eco Shopping Coach</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Set a monthly carbon budget and see how your month is going.
          Recorded carbon counts first; anything estimated is labeled as
          an estimate, and lower-carbon alternatives are real catalog
          products with lower recorded carbon. Budgets and carbon totals
          are computed with deterministic rules from recorded data —
          no LLM, nothing guessed.
        </p>

        {!budgetEnabled && (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Carbon budgets are not live yet — the owner still needs to run
            the Section 7 migration (eco_budgets table) once.
          </p>
        )}

        <form className="mt-6 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); load(month); }}>
          <div className="space-y-2">
            <Label htmlFor="ecoMonth">Month</Label>
            <Input
              id="ecoMonth"
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={loading}>
            View month
          </Button>
        </form>

        {loading ? (
          <div className="mt-6">
            <LoadingSpinner />
          </div>
        ) : unauthorized ? (
          <div className="mt-6">
            <EmptyState
              title="Sign in to use the eco coach"
              description="Your carbon budget and purchases are private to your account."
            />
            <p className="mt-4 text-sm">
              <Link href="/sign-in" className="underline">
                Sign in
              </Link>
            </p>
          </div>
        ) : failed || !data || !spend ? (
          <div className="mt-6">
            <EmptyState
              title="Eco coach could not be loaded"
              description="Try again later. No numbers are shown rather than guessed ones."
            />
          </div>
        ) : (
          <>
            <section className="mt-6 grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Monthly budget</p>
                <p className="mt-1 text-xl font-semibold">
                  {data.budget ? `${data.budget.budget_kg} kg CO2e` : 'Not set'}
                </p>
                {status && status.percentUsed !== null ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {status.percentUsed}% used — {status.status}
                  </p>
                ) : null}
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Spent this month</p>
                <p className="mt-1 text-xl font-semibold">{spend.totalKg} kg CO2e</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {spend.recordedKg} kg recorded · {spend.estimatedKg} kg estimated
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Purchases</p>
                <p className="mt-1 text-xl font-semibold">{spend.purchaseCount}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {spend.recordedCount} recorded · {spend.estimatedCount} estimated ·{' '}
                  {spend.unknownCount} with no carbon data
                </p>
              </div>
            </section>
            {spend.hasEstimates ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Part of this month&apos;s total is an estimate — Estimate
                only — not a certified lifecycle assessment. Purchases with
                no carbon data add nothing to the total.
              </p>
            ) : null}
            {!spend.vaultEnabled ? (
              <p className="mt-3 text-sm text-muted-foreground">
                The Receipt Vault is not set up yet, so monthly spend cannot
                be derived — add vault purchases once it is live.
              </p>
            ) : spend.purchaseCount === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No vault purchases this month — spend is counted from your
                Receipt Vault purchases only.
              </p>
            ) : null}

            <section className="mt-8 rounded-lg border p-4">
              <h2 className="text-lg font-semibold">Set your carbon budget</h2>
              <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={saveBudget}>
                <div className="space-y-2">
                  <Label htmlFor="ecoBudget">Budget (kg CO2e / month)</Label>
                  <Input
                    id="ecoBudget"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="e.g. 50"
                    value={budgetInput}
                    onChange={(e) => setBudgetInput(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving…' : 'Save budget'}
                </Button>
                {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
              </form>
            </section>

            <section className="mt-8 rounded-lg border p-4">
              <h2 className="text-lg font-semibold">Coach note for a purchase</h2>
              <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={askCoach}>
                <div className="space-y-2">
                  <Label htmlFor="ecoSlug">Product slug</Label>
                  <Input
                    id="ecoSlug"
                    placeholder="e.g. macbook-air-m4"
                    value={productSlug}
                    onChange={(e) => setProductSlug(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" disabled={coachLoading}>
                  {coachLoading ? 'Checking…' : 'Ask the coach'}
                </Button>
              </form>
              {data.coachNote ? (
                <div className="mt-4">
                  <p className="font-medium">{data.coachNote.productName}</p>
                  <p className="mt-1 text-sm">{data.coachNote.note}</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Carbon: {data.coachNote.carbon.kind === 'unknown' || data.coachNote.carbon.kgCO2e === null
                      ? 'No carbon data'
                      : `${data.coachNote.carbon.kgCO2e} kg CO2e (${data.coachNote.carbon.kind})`}
                    {data.coachNote.carbon.kind === 'recorded' && data.coachNote.carbon.band
                      ? ` · band ${data.coachNote.carbon.band}`
                      : ''}
                  </p>
                  {data.coachNote.carbon.kind === 'estimate' ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Estimate only — not a certified lifecycle assessment.
                    </p>
                  ) : null}
                  {data.coachNote.alternatives.length > 0 ? (
                    <div className="mt-3">
                      <h3 className="text-sm font-semibold">Lower-carbon alternatives (recorded carbon)</h3>
                      <ul className="mt-1 space-y-1 text-sm">
                        {data.coachNote.alternatives.map((alt) => (
                          <li key={alt.slug}>
                            <Link href={`/products/${alt.slug}`} className="underline">
                              {alt.name}
                            </Link>{' '}
                            — {alt.recordedKg} kg CO2e (saves {alt.savingKg} kg)
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : data.coachNote.alternativesNote ? (
                    <p className="mt-3 text-sm text-muted-foreground">{data.coachNote.alternativesNote}</p>
                  ) : null}
                </div>
              ) : null}
            </section>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
