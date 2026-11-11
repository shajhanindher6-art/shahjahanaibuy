/**
 * Budget Finder — /tools/budget-finder (Section 11).
 *
 * Dedicated ranked page reading ?category=...&budget=... (e.g.
 * ?category=laptop&budget=1000): every priced product in that
 * category at or under that budget, ranked by biggest saving first,
 * then Deal Score, then lowest price.
 *
 * - Server component, no JavaScript needed: the form submits as a
 *   plain GET to this same page.
 * - Ranking is the ONE shared helper in services/guided-finder.ts
 *   (same as the quiz) — sortBy 'deal'. No second scorer.
 * - Budget is a HARD filter; unpriced products and the
 *   'sample-laptop' demo row are never picks (see the loader).
 * - Empty state is honest: "no priced {category} under ${budget}"
 *   — never padded with an over-budget or irrelevant product.
 */

import Link from 'next/link';
import { Wallet } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  GUIDED_CATEGORIES,
  loadGuidedCandidates,
  parseBudgetFinderParams,
  rankGuidedPicks,
} from '@/services/guided-finder';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Budget Finder — SmartBuy',
  description:
    'Best priced products under your budget, ranked by biggest saving first. Real merchant prices only.',
};

interface BudgetFinderProps {
  searchParams: { category?: string | string[]; budget?: string | string[] };
}

export default async function BudgetFinderPage({ searchParams }: BudgetFinderProps) {
  const { category, budgetUsd, budgetError } = parseBudgetFinderParams(searchParams);
  const hasQuery = category !== null || budgetUsd !== null;

  const picks =
    hasQuery && !budgetError
      ? rankGuidedPicks(await loadGuidedCandidates(await createSupabaseServerClient()), {
          category,
          budgetUsd,
          sortBy: 'deal',
          limit: 12,
        })
      : null;

  const heading =
    category && budgetUsd !== null
      ? `Best ${category} under $${budgetUsd.toFixed(2)}`
      : category
        ? `Best ${category} — pick a budget to narrow it down`
        : budgetUsd !== null
          ? `Best products under $${budgetUsd.toFixed(2)}`
          : 'Find the best product under your budget';

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Wallet className="h-7 w-7 text-blue-600" /> Budget Finder
          </h1>
          <p className="mt-2 text-muted-foreground">
            Pick a category and a budget — every priced product that
            fits, ranked by biggest saving first, then Deal Score.
            Prices are verified merchant prices; products without a
            priced listing are never shown.
          </p>

          <form
            method="get"
            action="/tools/budget-finder"
            className="mt-8 rounded-lg border p-6"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="category" className="text-sm font-medium">
                  Category
                </label>
                <select
                  id="category"
                  name="category"
                  defaultValue={category ?? ''}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">Any category</option>
                  {GUIDED_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="budget" className="text-sm font-medium">
                  Max budget (USD)
                </label>
                <input
                  id="budget"
                  name="budget"
                  type="number"
                  min="1"
                  step="1"
                  inputMode="decimal"
                  placeholder="e.g. 1000"
                  defaultValue={budgetUsd !== null ? String(budgetUsd) : ''}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
            {budgetError && (
              <p className="mt-3 text-sm font-medium text-red-600" role="alert">
                {budgetError}
              </p>
            )}
            <Button type="submit" className="mt-4">
              Find deals →
            </Button>
          </form>

          {hasQuery && !budgetError && (
            <section className="mt-10" aria-live="polite">
              <h2 className="text-xl font-semibold">{heading}</h2>

              {picks !== null && picks.length === 0 && (
                <div className="mt-6">
                  <EmptyState
                    eyebrow="No priced match"
                    title={
                      category && budgetUsd !== null
                        ? `No priced ${category} under $${budgetUsd.toFixed(2)}`
                        : 'No priced match for this budget'
                    }
                    description="No product with a verified price fits this budget and category right now — the catalog is small. Try a higher budget or a different category."
                    action={
                      <Link
                        href="/tools/budget-finder"
                        className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                      >
                        Clear and try again
                      </Link>
                    }
                  />
                </div>
              )}

              {picks !== null && picks.length > 0 && (
                <div className="mt-6 space-y-4">
                  {picks.map((pick, i) => (
                    <article key={pick.slug} className="rounded-lg border p-6">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            #{i + 1} · {pick.verdict}
                          </p>
                          <h3 className="mt-1 text-lg font-semibold">
                            <Link
                              href={`/products/${pick.slug}`}
                              className="underline-offset-4 hover:underline"
                            >
                              {pick.name}
                            </Link>
                          </h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {pick.brand ?? 'Unknown brand'}
                            {pick.category ? ` · ${pick.category}` : ''}
                            {pick.merchantName ? ` · at ${pick.merchantName}` : ''}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xl font-bold">
                            ${(pick.bestPriceUsd as number).toFixed(2)}
                          </p>
                          {pick.savingPct !== null && (
                            <p className="text-sm font-medium text-green-700">
                              Save {pick.savingPct}%
                            </p>
                          )}
                          {pick.dealScore !== null && (
                            <p className="text-xs text-muted-foreground">
                              Deal Score {pick.dealScore}/100
                            </p>
                          )}
                        </div>
                      </div>
                      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                        {pick.why.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                      <Link
                        href={`/products/${pick.slug}`}
                        className="mt-4 inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                      >
                        View product →
                      </Link>
                    </article>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    Ranked by biggest saving first, then Deal Score,
                    then lowest price. A product above your budget is
                    never listed, even if it is a great deal.
                  </p>
                </div>
              )}
            </section>
          )}

          {!hasQuery && (
            <p className="mt-8 text-sm text-muted-foreground">
              Tip: try{' '}
              <Link
                href="/tools/budget-finder?category=laptop&budget=1000"
                className="underline underline-offset-4"
              >
                laptops under $1,000
              </Link>{' '}
              or{' '}
              <Link
                href="/tools/budget-finder?category=headphones&budget=250"
                className="underline underline-offset-4"
              >
                headphones under $250
              </Link>
              .
            </p>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
