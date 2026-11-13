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

import { cookies } from 'next/headers';
import { isSupportedLanguage, type Language } from '@/lib/region';
import { tFor } from '@/lib/i18n';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Wallet } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { ShareButtons } from '@/components/products/share-buttons';
import { SaveCalculationButton } from '@/components/tools/save-calculation-button';
import { appConfig } from '@/lib/config/app';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { formatOriginalAmount } from '@/services/currency';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { StalePriceBadge } from '@/components/products/stale-price-badge';
import {
  GUIDED_CATEGORIES,
  GUIDED_SPEC_DATA_NOTE,
  loadGuidedCandidates,
  parseBudgetFinderParams,
  rankGuidedPicks,
  rankRelaxedGuidedPicks,
  specOptionsForCategory,
} from '@/services/guided-finder';

export const dynamic = 'force-dynamic';

// Section 12, Chunk E: canonical + Open Graph metadata, and the
// brand suffix fixed to "SmartBuy AI" (it was "SmartBuy"). The
// canonical URL is the bare tool URL — the ?category=&budget=
// variants are the same page with different inputs, not separate
// pages. No OG image: none exists for this tool, so Next falls back
// to the site-wide app/opengraph-image.tsx — never invent one.
export const metadata: Metadata = {
  title: 'Budget Finder — SmartBuy AI',
  description:
    'Best priced products under your budget, ranked by biggest saving first. Recorded prices only.',
  alternates: {
    canonical: `${appConfig.url}/tools/budget-finder`,
  },
  openGraph: {
    title: 'Budget Finder — SmartBuy AI',
    description:
      'Best priced products under your budget, ranked by biggest saving first. Recorded prices only.',
    url: `${appConfig.url}/tools/budget-finder`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Budget Finder — SmartBuy AI',
    description:
      'Best priced products under your budget, ranked by biggest saving first. Recorded prices only.',
  },
};

interface BudgetFinderProps {
  searchParams: { category?: string | string[]; budget?: string | string[] };
}

/**
 * Section 15 (C3): the server reads the same sb-language cookie the
 * root layout and homepage use for dir/lang — a first-visit language
 * switch via localStorage takes effect on the next load.
 */
function toolLanguage(): Language {
  const saved = cookies().get('sb-language')?.value ?? null;
  return saved && isSupportedLanguage(saved) ? saved : 'en';
}

export default async function BudgetFinderPage({ searchParams }: BudgetFinderProps) {
  const language = toolLanguage();
  const { category, budgetUsd, budgetOriginal, budgetCurrency, budgetError, needBy, needByError, specInputs } =
    parseBudgetFinderParams(searchParams);
  const hasQuery = category !== null || budgetUsd !== null || needBy !== null || Object.keys(specInputs).length > 0;
  const hasError = budgetError !== null || needByError !== null;
  // Section 19, Phase 4 (§12 #46) — spec selects for the chosen
  // category (empty until a category is picked).
  const specOptions = specOptionsForCategory(category);

  const candidates =
    hasQuery && !hasError
      ? await loadGuidedCandidates(await createSupabaseServerClient())
      : [];
  const picks =
    hasQuery && !hasError
      ? rankGuidedPicks(candidates, {
          category,
          budgetUsd,
          needBy,
          specInputs,
          sortBy: 'deal',
          limit: 12,
        })
      : null;
  // B1: nearest-miss fallback, shown only under the empty state.
  // The Budget Finder takes no must-haves, so there is nothing to
  // relax and this is [] in practice — wired here so the shared
  // ranker change covers this page too if must-haves are ever
  // added to its form.
  const relaxed =
    picks !== null && picks.length === 0
      ? rankRelaxedGuidedPicks(
          candidates,
          { category, budgetUsd, needBy, specInputs, sortBy: 'deal' },
          3
        )
      : [];
  // Section 19, Phase 4 (§12 #37) — the deadline note is the same
  // for every pick (it comes from the deadline, not the product),
  // so the first pick carries it for the whole results section.
  const timelineNote = picks !== null && picks.length > 0 ? picks[0].timelineNote : null;

  // B9: show the amount the visitor actually wrote — "20,000 PKR
  // (≈ $71.00)" — not just the converted USD figure.
  const budgetLabel =
    budgetUsd !== null
      ? budgetCurrency && budgetCurrency !== 'USD' && budgetOriginal !== null
        ? `${formatOriginalAmount(budgetOriginal)} ${budgetCurrency} (≈ $${budgetUsd.toFixed(2)})`
        : `$${budgetUsd.toFixed(2)}`
      : null;
  const heading =
    category && budgetLabel
      ? `Best ${category} under ${budgetLabel}`
      : category
        ? `Best ${category} — pick a budget to narrow it down`
        : budgetLabel
          ? `Best products under ${budgetLabel}`
          : 'Find the best product under your budget';

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 17: WebPage + BreadcrumbList
          (Home → AI tools → this tool). */}
      <PageJsonLd
        name="Budget Finder"
        description="Best priced products under your budget, ranked by biggest saving first. Recorded prices only."
        path="/tools/budget-finder"
        crumbs={[
          { name: 'Home', path: '/' },
          { name: 'AI tools', path: '/tools' },
          { name: 'Budget Finder' },
        ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Wallet className="h-7 w-7 text-blue-600" /> {tFor(language, 'toolHeadingBudgetFinder')}
          </h1>
          <p className="mt-2 text-muted-foreground">
            Pick a category and a budget — every priced product that
            fits, ranked by biggest saving first, then Deal Score.
            Prices are recorded catalog prices, not verified live
            merchant prices — no price here was checked live at a
            merchant, and each pick below carries its last-checked
            age. Products without a priced listing are never shown.
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
                  Max budget
                </label>
                {/* Text, not number: a budget may carry a currency
                    ("20K PKR"), which a number input cannot hold.
                    parseBudgetFinderParams validates it server-side. */}
                <input
                  id="budget"
                  name="budget"
                  type="text"
                  inputMode="decimal"
                  placeholder="e.g. 1000 or 20K PKR"
                  // The amount as written ("20000 PKR"), not the
                  // converted USD figure — re-submitting "20000"
                  // alone would mean $20,000.
                  defaultValue={
                    budgetOriginal !== null
                      ? budgetCurrency && budgetCurrency !== 'USD'
                        ? `${budgetOriginal} ${budgetCurrency}`
                        : String(budgetOriginal)
                      : ''
                  }
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Another currency works too, e.g. 20K PKR — converted
                  to USD at an approximate rate.
                </p>
              </div>
            </div>
            {/* Section 19, Phase 4 (§12 #37) — optional "need by"
                date. A near deadline changes the advice: waiting for
                a price drop is not offered, because with only 4
                recorded price points no drop can be predicted before
                it. */}
            <div className="mt-4">
              <label htmlFor="needBy" className="text-sm font-medium">
                Need it by (optional)
              </label>
              <input
                id="needBy"
                name="needBy"
                type="date"
                defaultValue={needBy ?? ''}
                className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm sm:max-w-xs"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                If your deadline is within 14 days, waiting for a price drop is not offered — no
                drop can be predicted that soon from the recorded prices.
              </p>
            </div>
            {/* Section 19, Phase 4 (§12 #46) — structured spec
                inputs for the chosen category. Matched against
                product names/descriptions only (no spec data is
                recorded) — the results say so. */}
            {specOptions.length > 0 && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {specOptions.map((option) => (
                  <div key={option.key}>
                    <label htmlFor={`spec_${option.key}`} className="text-sm font-medium">
                      {option.label}
                    </label>
                    <select
                      id={`spec_${option.key}`}
                      name={`spec_${option.key}`}
                      defaultValue={specInputs[option.key] ?? ''}
                      className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                    >
                      <option value="">Any {option.label.toLowerCase()}</option>
                      {option.options.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
            {budgetError && (
              <p className="mt-3 text-sm font-medium text-red-600" role="alert">
                {budgetError}
              </p>
            )}
            {needByError && (
              <p className="mt-3 text-sm font-medium text-red-600" role="alert">
                {needByError}
              </p>
            )}
            <Button type="submit" className="mt-4">
              Find deals →
            </Button>
          </form>

          {hasQuery && !hasError && (
            <section className="mt-10" aria-live="polite">
              <h2 className="text-xl font-semibold">{heading}</h2>
              {timelineNote && (
                <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  {timelineNote}
                </p>
              )}
              {Object.keys(specInputs).length > 0 && (
                <p className="mt-2 text-sm text-muted-foreground">{GUIDED_SPEC_DATA_NOTE}</p>
              )}

              {/* Section 12, Chunk E: copy/share for these results.
                  The URL is already shareable (?category=&budget=,
                  same as the Quiz's ?answers= pattern) — ShareButtons
                  copies the current page URL, so a shared link
                  restores exactly these results. */}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  Share these results:
                </span>
                <ShareButtons
                  title={heading}
                  text={`${heading} — SmartBuy AI`}
                />
              </div>
              {/* Section 16, #36 — save this calculation to the
                  account, or copy its shareable link. The budget
                  param is the amount as written ("20K PKR"), not
                  the converted USD figure — re-opening the link
                  re-parses it exactly as the form did. */}
              <div className="mt-4">
                <SaveCalculationButton
                  tool="budget-finder"
                  label={heading.slice(0, 100)}
                  params={{
                    ...(category ? { category } : {}),
                    ...(budgetOriginal !== null
                      ? {
                          budget:
                            budgetCurrency && budgetCurrency !== 'USD'
                              ? `${budgetOriginal} ${budgetCurrency}`
                              : String(budgetOriginal),
                        }
                      : {}),
                    ...(needBy ? { needBy } : {}),
                    ...Object.fromEntries(
                      Object.entries(specInputs).map(([key, value]) => [`spec_${key}`, value])
                    ),
                  }}
                />
              </div>

              {picks !== null && picks.length === 0 && (
                <div className="mt-6">
                  <EmptyState
                    eyebrow="No priced match"
                    title={
                      category && budgetLabel
                        ? `No priced ${category} under ${budgetLabel}`
                        : 'No priced match for this budget'
                    }
                    description="No product with a recorded price fits this budget and category right now — the catalog is small. Try a higher budget or a different category."
                    action={
                      <Link
                        href="/tools/budget-finder"
                        className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                      >
                        Clear and try again
                      </Link>
                    }
                  />
                  {/* B1: nearest-miss fallback (see the note where
                      `relaxed` is computed — the Budget Finder
                      takes no must-haves, so this is empty in
                      practice, but the section is wired for the
                      shared ranker). */}
                  {relaxed.length > 0 && (
                    <div className="mt-8">
                      <h3 className="text-lg font-semibold">Closest matches</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        No exact match, but these come closest — each
                        misses at least one must-have, as labelled.
                      </p>
                      <div className="mt-4 space-y-4">
                        {relaxed.map((pick, i) => (
                          <article key={pick.slug} className="rounded-lg border p-6">
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                  Closest match {i + 1} · {pick.verdict}
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
                                    {pick.savingsUsd !== null && ` ($${pick.savingsUsd.toFixed(2)})`}
                                  </p>
                                )}
                                {pick.savingsVsBudgetUsd !== null && (
                                  <p className="text-xs text-muted-foreground">
                                    ${pick.savingsVsBudgetUsd.toFixed(2)} left of your budget
                                  </p>
                                )}
                                {/* Final 100% — F-P0-06: closest-match
                                    prices are recorded prices too. */}
                                <div className="mt-1">
                                  <StalePriceBadge dataFreshness={pick.dataFreshness} />
                                </div>
                              </div>
                            </div>
                            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                              {pick.why.map((line) => (
                                <li key={line}>{line}</li>
                              ))}
                            </ul>
                            <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                              Matches {pick.matchedMustHaveCount} of {pick.totalMustHaves} must-haves
                              — misses: {pick.missedMustHaves.join(', ')}
                            </p>
                            <Link
                              href={`/products/${pick.slug}`}
                              className="mt-4 inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                            >
                              View product →
                            </Link>
                          </article>
                        ))}
                      </div>
                    </div>
                  )}
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
                              {pick.savingsUsd !== null && ` ($${pick.savingsUsd.toFixed(2)})`}
                            </p>
                          )}
                          {pick.savingsVsBudgetUsd !== null && (
                            <p className="text-xs text-muted-foreground">
                              ${pick.savingsVsBudgetUsd.toFixed(2)} left of your budget
                            </p>
                          )}
                          {pick.dealScore !== null && (
                            <p className="text-xs text-muted-foreground">
                              Deal Score {pick.dealScore}/100
                            </p>
                          )}
                          {/* Final 100% — F-P0-06: a pick's price is
                              a recorded price, never a current one —
                              its last-checked age rides under the
                              price (stale badge, or "Price age
                              unknown" when no check date exists). */}
                          <div className="mt-1">
                            <StalePriceBadge dataFreshness={pick.dataFreshness} />
                          </div>
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
