/**
 * Gift Occasion Planner — /tools/gift-occasions (Section 16, E9).
 *
 * Upcoming occasions with dates + budgets → a dated plan with
 * lead time and one priced catalog pick per occasion.
 *
 * Server component, no JavaScript needed: up to 5 occasion rows
 * submit as a plain GET (?name=…&date=…&budget=…, repeated), so a
 * plan is a shareable URL. Picks come from services/gift-finder.ts
 * (findGiftPicks) over real priced catalog products, chosen by
 * BUDGET only — the catalog has no occasion tagging, so no
 * occasion → product mapping is ever invented.
 *
 * Honesty: this page shows a plan IN THE PAGE ONLY. It does not
 * send reminders, emails, or notifications — actual reminder
 * delivery would need push/email keys (owner-gated) — and no copy
 * anywhere promises one. The 7-day lead time is a planning
 * buffer, not a delivery promise: shipping times are not
 * recorded anywhere.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarHeart } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { SiteFooter } from '@/components/layout/site-footer';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { appConfig } from '@/lib/config/app';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { loadGuidedCandidates } from '@/services/guided-finder';
import { findGiftPicks } from '@/services/gift-finder';
import {
  GIFT_OCCASIONS_MAX_ROWS,
  GIFT_OCCASION_LEAD_DAYS,
  parseGiftOccasionParams,
  planGiftOccasions,
} from '@/lib/gift-occasions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Gift Occasion Planner — SmartBuy AI',
  description:
    'Plan upcoming gift occasions with dates and budgets — a dated plan with lead time and one priced catalog pick per occasion. Shown on this page only; no reminders are sent.',
  alternates: {
    canonical: `${appConfig.url}/tools/gift-occasions`,
  },
  openGraph: {
    title: 'Gift Occasion Planner — SmartBuy AI',
    description:
      'Plan upcoming gift occasions with dates and budgets — a dated plan with lead time and one priced catalog pick per occasion. Shown on this page only; no reminders are sent.',
    url: `${appConfig.url}/tools/gift-occasions`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Gift Occasion Planner — SmartBuy AI',
    description:
      'Plan upcoming gift occasions with dates and budgets — a dated plan with lead time and one priced catalog pick per occasion. Shown on this page only; no reminders are sent.',
  },
};

interface GiftOccasionsProps {
  searchParams: {
    name?: string | string[];
    date?: string | string[];
    budget?: string | string[];
  };
}

const FORM_ROWS = 3;

export default async function GiftOccasionsPage({
  searchParams,
}: GiftOccasionsProps) {
  const { occasions, errors, hasQuery } = parseGiftOccasionParams(searchParams);
  const plans = planGiftOccasions(occasions);

  // One priced pick per upcoming occasion (budget only — the
  // catalog has no occasion tagging). Loaded only when a plan
  // exists; a failed load renders "no pick" lines, never a guess.
  let candidates: Array<{
    id: string;
    name: string;
    slug: string;
    brand: string | null;
    category: string | null;
    description: string | null;
    bestPriceUsd: number | null;
    compareAtUsd: number | null;
    merchantName: string | null;
    couponLabel: string | null;
  }> = [];
  if (plans.some((p) => p.status !== 'passed')) {
    const loaded = await loadGuidedCandidates(await createSupabaseServerClient());
    candidates = loaded.map((c) => ({ ...c, couponLabel: null }));
  }
  const pickFor = (budgetUsd: number) =>
    findGiftPicks(candidates, { budgetUsd, interests: [], limit: 1 })[0] ?? null;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 17: page-level JSON-LD (WebPage + BreadcrumbList). */}
      <PageJsonLd
        name="Gift Occasion Planner"
        description="Plan upcoming gift occasions with dates and budgets — a dated plan with lead time and one priced catalog pick per occasion. Shown on this page only; no reminders are sent."
        path="/tools/gift-occasions"
        crumbs={[ { name: "Home", path: "/" }, { name: "AI tools", path: "/tools" }, { name: "Gift Occasion Planner" } ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <CalendarHeart className="h-7 w-7 text-blue-600" /> Gift Occasion Planner
          </h1>
          <p className="mt-2 text-muted-foreground">
            List your upcoming gift occasions with a date and a
            budget, and get a dated plan: how many days are left,
            when to plan to order (a {GIFT_OCCASION_LEAD_DAYS}-day
            planning buffer — not a delivery promise), and one priced
            catalog pick that fits each budget. This plan is shown on
            this page only — SmartBuy does not send occasion
            reminders.
          </p>

          <form
            method="get"
            action="/tools/gift-occasions"
            className="mt-8 rounded-lg border p-6"
          >
            {Array.from({ length: FORM_ROWS }, (_, i) => (
              <div key={i} className="mb-4 grid gap-3 sm:grid-cols-3">
                <div>
                  <label htmlFor={`name-${i}`} className="text-sm font-medium">
                    Occasion {i + 1}
                  </label>
                  <input
                    id={`name-${i}`}
                    name="name"
                    type="text"
                    placeholder="e.g. Birthday"
                    defaultValue={occasions[i]?.name ?? ''}
                    className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor={`date-${i}`} className="text-sm font-medium">
                    Date
                  </label>
                  <input
                    id={`date-${i}`}
                    name="date"
                    type="date"
                    defaultValue={occasions[i]?.date ?? ''}
                    className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor={`budget-${i}`} className="text-sm font-medium">
                    Budget (USD)
                  </label>
                  <input
                    id={`budget-${i}`}
                    name="budget"
                    type="number"
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="e.g. 100"
                    defaultValue={occasions[i] ? String(occasions[i].budgetUsd) : ''}
                    className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>
            ))}
            {errors.length > 0 && (
              <div className="mt-3" role="alert">
                {errors.map((e) => (
                  <p key={e} className="text-sm font-medium text-red-600">
                    {e}
                  </p>
                ))}
              </div>
            )}
            <Button type="submit" className="mt-4">
              Plan occasions →
            </Button>
            <p className="mt-3 text-xs text-muted-foreground">
              Up to {GIFT_OCCASIONS_MAX_ROWS} occasions per plan.
              Blank rows are ignored.
            </p>
          </form>

          {hasQuery && plans.length === 0 && (
            <div className="mt-6">
              <EmptyState
                eyebrow="No occasions to plan"
                title="Add at least one occasion with a date and a budget"
                description="Each row needs a name, a valid date, and a budget above $0."
              />
            </div>
          )}

          {plans.length > 0 && (
            <section className="mt-10" aria-live="polite">
              <h2 className="text-xl font-semibold">Your gift plan</h2>
              <div className="mt-4 space-y-4">
                {plans.map((plan) => {
                  const pick = plan.status === 'passed' ? null : pickFor(plan.budgetUsd);
                  return (
                    <article key={`${plan.name}-${plan.date}`} className="rounded-lg border p-6">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h3 className="text-lg font-semibold">{plan.name}</h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {new Date(`${plan.date}T00:00:00`).toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric',
                            })}{' '}
                            · Budget ${plan.budgetUsd.toFixed(2)}
                          </p>
                        </div>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">
                          {plan.status === 'passed'
                            ? `Passed ${Math.abs(plan.daysUntil)} day${Math.abs(plan.daysUntil) === 1 ? '' : 's'} ago`
                            : plan.status === 'today'
                              ? 'Today'
                              : `${plan.daysUntil} day${plan.daysUntil === 1 ? '' : 's'} left`}
                        </span>
                      </div>
                      {plan.status === 'passed' ? (
                        <p className="mt-3 text-sm text-muted-foreground">
                          This date has passed — pick a new date to plan it again.
                        </p>
                      ) : (
                        <>
                          <p className="mt-3 text-sm text-muted-foreground">
                            Plan to order by{' '}
                            {plan.orderByDate !== null
                              ? new Date(`${plan.orderByDate}T00:00:00`).toLocaleDateString(
                                  'en-US',
                                  { year: 'numeric', month: 'long', day: 'numeric' }
                                )
                              : '—'}{' '}
                            ({GIFT_OCCASION_LEAD_DAYS}-day planning buffer; shipping times are
                            not recorded, so confirm delivery at checkout).
                          </p>
                          {pick ? (
                            <p className="mt-3 text-sm">
                              Priced pick within budget:{' '}
                              <Link
                                href={`/products/${pick.slug}`}
                                className="font-semibold underline-offset-4 hover:underline"
                              >
                                {pick.name}
                              </Link>{' '}
                              — ${(pick.bestPriceUsd as number).toFixed(2)}
                              {pick.merchantName ? ` at ${pick.merchantName}` : ''}
                              .
                            </p>
                          ) : (
                            <p className="mt-3 text-sm text-muted-foreground">
                              No priced catalog gift fits this budget — no
                              over-budget pick is forced.
                            </p>
                          )}
                        </>
                      )}
                    </article>
                  );
                })}
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Picks are chosen by budget only: the catalog has no
                occasion tagging, so no occasion → gift mapping is
                claimed. This plan is displayed here only — SmartBuy
                does not send reminders for these occasions.
              </p>
            </section>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
