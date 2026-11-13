'use client';

import { useRegion } from '@/components/region/region-provider';
import { tFor } from '@/lib/i18n';
import { useCallback, useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { budgetStatus, explainTechBudgetOverrun, DEFAULT_DAILY_TARGET_HOURS, DEFAULT_MONTHLY_TECH_BUDGET_USD, type TechBudgetItem } from '@/services/tech-budget';
import { cn } from '@/lib/utils';

/**
 * Tech Budget Widget (Option 16, Step 1 Module 2) — dashboard.
 *
 * Monthly tech budget vs the total ownership cost of the user's
 * wishlist items (lowest recorded merchant price per product; items
 * with no recorded price count $0 and are flagged, never guessed).
 *
 * Signed-in: budget is read/saved via /api/v1/tech-budget and the
 * wishlist rollup via /api/v1/dashboard/tech-budget. Signed-out: the
 * budget editor saves on this device only (localStorage) and the
 * wishlist section asks the user to sign in. When migration 019 has
 * not been run, saving to the server fails with an honest note and
 * the local editor is still offered — the widget never breaks the
 * dashboard.
 */

const LOCAL_KEY = 'sb-tech-budget';

interface DashboardTechBudget {
  monthlyTechBudgetUsd: number;
  dailyTargetHours: number;
  saved: boolean;
  wishlistTotalUsd: number;
  wishlistItemCount: number;
  wishlistPricedCount: number;
  wishlistUnpricedCount: number;
  wishlistItems: TechBudgetItem[];
}

function readLocal(): { monthly: number; hours: number } {
  if (typeof localStorage === 'undefined') {
    return { monthly: DEFAULT_MONTHLY_TECH_BUDGET_USD, hours: DEFAULT_DAILY_TARGET_HOURS };
  }
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return { monthly: DEFAULT_MONTHLY_TECH_BUDGET_USD, hours: DEFAULT_DAILY_TARGET_HOURS };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const monthly = Number(parsed.monthlyTechBudgetUsd);
    const hours = Number(parsed.dailyTargetHours);
    return {
      monthly: Number.isFinite(monthly) && monthly > 0 ? monthly : DEFAULT_MONTHLY_TECH_BUDGET_USD,
      hours: Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_DAILY_TARGET_HOURS,
    };
  } catch {
    return { monthly: DEFAULT_MONTHLY_TECH_BUDGET_USD, hours: DEFAULT_DAILY_TARGET_HOURS };
  }
}

export function TechBudgetWidget() {
  const { language } = useRegion();
  const [data, setData] = useState<DashboardTechBudget | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [monthlyInput, setMonthlyInput] = useState(String(DEFAULT_MONTHLY_TECH_BUDGET_USD));
  const [hoursInput, setHoursInput] = useState(String(DEFAULT_DAILY_TARGET_HOURS));
  const [editing, setEditing] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/dashboard/tech-budget');
      if (res.status === 401) {
        const local = readLocal();
        setSignedIn(false);
        setData({
          monthlyTechBudgetUsd: local.monthly,
          dailyTargetHours: local.hours,
          saved: false,
          wishlistTotalUsd: 0,
          wishlistItemCount: 0,
          wishlistPricedCount: 0,
          wishlistUnpricedCount: 0,
          wishlistItems: [],
        });
        setMonthlyInput(String(local.monthly));
        setHoursInput(String(local.hours));
        return;
      }
      if (!res.ok) throw new Error('tech-budget request failed');
      const json = await res.json();
      const payload = json?.data as {
        budget?: { monthlyTechBudgetUsd: number; dailyTargetHours: number; saved: boolean };
        wishlist?: {
          totalUsd: number;
          itemCount: number;
          pricedCount: number;
          unpricedCount: number;
          items?: TechBudgetItem[];
        };
      } | null;
      if (!payload) throw new Error('tech-budget response empty');
      const budget = payload.budget ?? {
        monthlyTechBudgetUsd: DEFAULT_MONTHLY_TECH_BUDGET_USD,
        dailyTargetHours: DEFAULT_DAILY_TARGET_HOURS,
        saved: false,
      };
      setSignedIn(true);
      setData({
        monthlyTechBudgetUsd: budget.monthlyTechBudgetUsd,
        dailyTargetHours: budget.dailyTargetHours,
        saved: budget.saved,
        wishlistTotalUsd: payload.wishlist?.totalUsd ?? 0,
        wishlistItemCount: payload.wishlist?.itemCount ?? 0,
        wishlistPricedCount: payload.wishlist?.pricedCount ?? 0,
        wishlistUnpricedCount: payload.wishlist?.unpricedCount ?? 0,
        wishlistItems: payload.wishlist?.items ?? [],
      });
      setMonthlyInput(String(budget.monthlyTechBudgetUsd));
      setHoursInput(String(budget.dailyTargetHours));
    } catch {
      // Fail-soft: local editor still works without the server.
      const local = readLocal();
      setSignedIn(false);
      setData({
        monthlyTechBudgetUsd: local.monthly,
        dailyTargetHours: local.hours,
        saved: false,
        wishlistTotalUsd: 0,
        wishlistItemCount: 0,
        wishlistPricedCount: 0,
        wishlistUnpricedCount: 0,
        wishlistItems: [],
      });
      setMonthlyInput(String(local.monthly));
      setHoursInput(String(local.hours));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    const monthly = Number(monthlyInput);
    const hours = Number(hoursInput);
    if (!Number.isFinite(monthly) || monthly <= 0 || !Number.isFinite(hours) || hours <= 0) {
      setSavedNote('Enter a budget and daily hours above 0.');
      return;
    }
    if (signedIn) {
      try {
        const res = await fetch('/api/v1/tech-budget', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ monthlyTechBudgetUsd: monthly, dailyTargetHours: hours }),
        });
        if (res.status === 503) {
          setTableMissing(true);
          setSavedNote('Tech budget table is not set up yet — run migration 019 in Supabase. Saved on this device instead.');
          localStorage.setItem(LOCAL_KEY, JSON.stringify({ monthlyTechBudgetUsd: monthly, dailyTargetHours: hours }));
          return;
        }
        if (!res.ok) throw new Error('save failed');
        setSavedNote('Budget saved.');
        setEditing(false);
        await load();
        return;
      } catch {
        setSavedNote('Could not reach the server — saved on this device instead.');
        localStorage.setItem(LOCAL_KEY, JSON.stringify({ monthlyTechBudgetUsd: monthly, dailyTargetHours: hours }));
        return;
      }
    }
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ monthlyTechBudgetUsd: monthly, dailyTargetHours: hours }));
    setSavedNote('Saved on this device only — sign in to keep it in your account.');
    setEditing(false);
    const local = readLocal();
    setData((prev) =>
      prev ? { ...prev, monthlyTechBudgetUsd: local.monthly, dailyTargetHours: local.hours, saved: false } : prev
    );
  }

  if (loading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-5 w-5 text-muted-foreground" />
            {tFor(language, 'dashTechBudget')}
          </CardTitle>
          <CardDescription>Monthly tech budget vs your wishlist</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading your tech budget…</p>
        </CardContent>
      </Card>
    );
  }

  const status = budgetStatus({
    monthlyBudgetUsd: data.monthlyTechBudgetUsd,
    wishlistTotalUsd: data.wishlistTotalUsd,
  });

  // Section 19, Phase 4 (§12 #39) — an over-budget total is
  // explained (which items drive it, what to drop, and a real
  // in-budget alternative), never just reported as a red number.
  const overrun =
    signedIn && status.overBudget
      ? explainTechBudgetOverrun({
          monthlyBudgetUsd: data.monthlyTechBudgetUsd,
          totalUsd: data.wishlistTotalUsd,
          items: data.wishlistItems,
        })
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="h-5 w-5 text-muted-foreground" />
          {tFor(language, 'dashTechBudget')}
        </CardTitle>
        <CardDescription>
          {signedIn
            ? 'Monthly tech budget vs the total cost of your wishlist items'
            : 'Monthly tech budget — sign in to compare it with your wishlist'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-xs text-muted-foreground">Monthly budget</p>
            <p className="text-lg font-bold">${data.monthlyTechBudgetUsd.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Wishlist total</p>
            <p className="text-lg font-bold">
              {signedIn ? `$${data.wishlistTotalUsd.toLocaleString()}` : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Remaining</p>
            <p className={cn('text-lg font-bold', status.overBudget ? 'text-red-600' : 'text-emerald-700')}>
              {signedIn ? `$${status.remainingUsd.toLocaleString()}` : '—'}
            </p>
          </div>
        </div>

        {signedIn && data.wishlistItemCount > 0 && (
          <p className="text-sm text-muted-foreground">
            {data.wishlistItemCount} wishlist item{data.wishlistItemCount === 1 ? '' : 's'}
            {data.wishlistUnpricedCount > 0 &&
              ` — ${data.wishlistUnpricedCount} without a recorded price (counted as $0, never guessed)`}
            {status.overBudget
              ? `. Your wishlist costs more than one month of tech budget.`
              : '. Your wishlist fits inside one month of tech budget.'}
          </p>
        )}
        {overrun && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
            <p className="font-medium">
              ${overrun.overByUsd.toLocaleString()} over budget — here is why:
            </p>
            {overrun.drivers.length > 0 && (
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {overrun.drivers.map((driver) => (
                  <li key={driver.productId}>
                    {driver.name} — ${driver.priceUsd.toLocaleString()} ({driver.sharePct}% of your wishlist total)
                  </li>
                ))}
              </ul>
            )}
            {overrun.dropToFit && (
              <p className="mt-1">
                Removing {overrun.dropToFit.names.join(', ')} would bring the total to $
                {overrun.dropToFit.newTotalUsd.toLocaleString()} — inside your budget.
              </p>
            )}
            {overrun.replacementBudgetUsd !== null && (
              <p className="mt-1">
                Or swap the priciest item for a cheaper alternative:{' '}
                <a
                  className="underline underline-offset-4"
                  href={`/tools/budget-finder?${overrun.replacementCategory ? `category=${encodeURIComponent(overrun.replacementCategory)}&` : ''}budget=${overrun.replacementBudgetUsd}`}
                >
                  find {overrun.replacementCategory ?? 'products'} under $
                  {overrun.replacementBudgetUsd.toLocaleString()}
                </a>
                .
              </p>
            )}
          </div>
        )}
        {signedIn && data.wishlistItemCount === 0 && (
          <p className="text-sm text-muted-foreground">
            Your wishlist is empty — add products to compare their total cost with your budget.
          </p>
        )}
        {!signedIn && (
          <p className="text-sm text-muted-foreground">
            Sign in to see your wishlist total next to your budget. Your budget below is saved on this device only.
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          Daily target: {data.dailyTargetHours} active hours a day
          {data.saved ? '' : ' (not saved in your account yet)'}.
        </p>

        {tableMissing && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Tech budget table is not set up yet — run migration 019 in Supabase to save budgets in your account.
          </p>
        )}

        {editing ? (
          <div className="space-y-3 rounded-md border p-3">
            <div>
              <label htmlFor="tech-budget-monthly" className="text-sm font-medium">
                Monthly tech budget (USD)
              </label>
              <Input
                id="tech-budget-monthly"
                type="number"
                min={1}
                step={10}
                value={monthlyInput}
                onChange={(e) => setMonthlyInput(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <label htmlFor="tech-budget-hours" className="text-sm font-medium">
                Daily target hours
              </label>
              <Input
                id="tech-budget-hours"
                type="number"
                min={0.5}
                step={0.5}
                value={hoursInput}
                onChange={(e) => setHoursInput(e.target.value)}
                className="mt-1"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={save}>
                Save budget
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
                {tFor(language, 'commonCancel')}
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Edit budget
          </Button>
        )}
        {savedNote && <p className="text-sm text-muted-foreground">{savedNote}</p>}
      </CardContent>
    </Card>
  );
}
