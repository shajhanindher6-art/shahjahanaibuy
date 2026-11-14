/**
 * AI Persona Fit Finder — /tools/persona-fit.
 *
 * Pick a persona (Student, Creator, Gamer, Traveler, Home Office,
 * Fitness) + a budget → scored catalog matches, ranked.
 *
 * Server component, no JavaScript needed: the form submits as a
 * plain GET to this same page. Data: getCachedProducts +
 * getLowestMerchantPrices + getProductAttributes, ranked by
 * lib/persona-fit.ts (which reuses the services/persona-matcher.ts
 * engine — no new scoring here).
 *
 * Honesty: with 0 specs rows and 0 categories rows, matches score
 * on whatever is recorded (category text + price band). Every
 * result carries "scored on category and price only — no specs
 * recorded yet". No match above threshold (a category fit within
 * budget) → honest empty state, never a forced pick. No fit
 * percentage is ever claimed. The six UI personas map onto the
 * engine's four personas — see lib/persona-fit.ts for the mapping
 * (Traveler, Home Office and Fitness score with the Work persona,
 * labelled as such on the page).
 */

import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { UserCheck } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { RelatedTools } from '@/components/tools/related-tools';
import { SaveCalculationButton } from '@/components/tools/save-calculation-button';
import { ShareButtons } from '@/components/products/share-buttons';
import { StalePriceBadge } from '@/components/products/stale-price-badge';
import { appConfig } from '@/lib/config/app';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getLowestMerchantPrices, getProductAttributes } from '@/services/products';
import { getCachedProducts, parseToolParams } from '@/services/tool-integration';
import { getUserPreferences } from '@/services/user-preferences';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import {
  enginePersonaFor,
  parsePersonaFitParams,
  rankPersonaMatches,
  PERSONA_FIT_SCORING_NOTE,
  UI_PERSONAS,
} from '@/lib/persona-fit';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AI Persona Fit Finder — SmartBuy AI',
  description:
    'Pick a persona and a budget — catalog products that fit, ranked. Scored on category and price only — no specs recorded yet.',
  alternates: {
    canonical: `${appConfig.url}/tools/persona-fit`,
  },
  openGraph: {
    title: 'AI Persona Fit Finder — SmartBuy AI',
    description:
      'Pick a persona and a budget — catalog products that fit, ranked. Scored on category and price only — no specs recorded yet.',
    url: `${appConfig.url}/tools/persona-fit`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'AI Persona Fit Finder — SmartBuy AI',
    description:
      'Pick a persona and a budget — catalog products that fit, ranked. Scored on category and price only — no specs recorded yet.',
  },
};

interface PersonaFitPageProps {
  searchParams: { persona?: string | string[]; budget?: string | string[] };
}

export default async function PersonaFitPage({ searchParams }: PersonaFitPageProps) {
  const { persona, personaError, budgetUsd, budgetError, hasQuery } =
    parsePersonaFitParams(searchParams);
  const hasError = personaError !== null || budgetError !== null;

  const supabase = await createSupabaseServerClient();

  // Stage 3, S3-4: stored-budget default from user_preferences.
  // The URL always wins: the stored budget applies only when the
  // URL carries no ?budget= (a present-but-invalid budget still
  // shows its error, never a silent stored value). Signed-out
  // visitors see no change. The stored value only PREFILLS the
  // form and caps a run the URL already started — it never
  // auto-runs a search (hasQuery stays URL-only). No persona is
  // stored in user_preferences (budget/brands/categories/
  // retailers only), so no persona can be preselected from it.
  const urlBudgetRaw = Array.isArray(searchParams.budget)
    ? searchParams.budget[0]
    : searchParams.budget;
  const hasUrlBudget =
    urlBudgetRaw !== undefined && urlBudgetRaw.trim() !== '';
  let storedBudgetUsd: number | null = null;
  if (!hasUrlBudget && !hasError) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const prefs = await getUserPreferences(supabase, user.id);
      storedBudgetUsd = prefs?.budgetMax ?? null;
    }
  }
  const effectiveBudgetUsd = budgetUsd ?? storedBudgetUsd;

  const { products } =
    hasQuery && !hasError
      ? await getCachedProducts(supabase, { page: 1, pageSize: 100 })
      : { products: [] };

  const matches =
    hasQuery && !hasError && persona !== null
      ? rankPersonaMatches(
          enginePersonaFor(persona),
          await Promise.all(
            products.map(async (product) => {
              const lowest = await getLowestMerchantPrices(supabase, [product.id]);
              const attributes = await getProductAttributes(supabase, product.id);
              return {
                id: product.id,
                slug: product.slug,
                name: product.name,
                brand: product.brand,
                category: product.category,
                priceUsd: lowest.get(product.id)?.price ?? null,
                dataFreshness: product.dataFreshness,
                attributes: attributes.map((a) => ({
                  key: a.key,
                  value: a.value,
                  unit: a.unit,
                })),
              };
            })
          ),
          effectiveBudgetUsd
        )
      : null;

  const heading =
    persona && effectiveBudgetUsd !== null
      ? `${persona.label} picks under $${effectiveBudgetUsd.toFixed(2)}`
      : persona
        ? `${persona.label} picks`
        : 'Find products that fit your persona';

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 17: WebPage + BreadcrumbList
          (Home → AI tools → this tool). */}
      <PageJsonLd
        name="AI Persona Fit Finder"
        description="Pick a persona and a budget — catalog products that fit, ranked. Scored on category and price only — no specs recorded yet."
        path="/tools/persona-fit"
        crumbs={[
          { name: 'Home', path: '/' },
          { name: 'AI tools', path: '/tools' },
          { name: 'AI Persona Fit Finder' },
        ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <UserCheck className="h-7 w-7 text-blue-600" /> AI Persona Fit Finder
          </h1>
          <p className="mt-2 text-muted-foreground">
            Pick a persona and a budget — the catalog products whose
            category fits that persona, ranked by the persona engine,
            within your budget. {PERSONA_FIT_SCORING_NOTE} A product
            whose category does not fit the persona is never listed,
            and a product above your budget is never listed either.
          </p>

          <form
            method="get"
            action="/tools/persona-fit"
            className="mt-8 rounded-lg border p-6"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="persona" className="text-sm font-medium">
                  Persona
                </label>
                <select
                  id="persona"
                  name="persona"
                  defaultValue={persona?.id ?? ''}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">Pick a persona</option>
                  {UI_PERSONAS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Student, Creator, Gamer, Traveler, Home Office or Fitness.
                </p>
              </div>
              <div>
                <label htmlFor="budget" className="text-sm font-medium">
                  Max budget (USD)
                </label>
                <input
                  id="budget"
                  name="budget"
                  type="text"
                  inputMode="decimal"
                  placeholder="e.g. 1000"
                  defaultValue={effectiveBudgetUsd !== null ? String(effectiveBudgetUsd) : ''}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Optional — without a budget, every category fit is shown.
                </p>
                {!hasUrlBudget && storedBudgetUsd !== null && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Using your saved budget of ${storedBudgetUsd.toFixed(2)} — change it above, or pass ?budget= in the URL to override it.
                  </p>
                )}
              </div>
            </div>
            {personaError && (
              <p className="mt-3 text-sm font-medium text-red-600" role="alert">
                {personaError}
              </p>
            )}
            {budgetError && (
              <p className="mt-3 text-sm font-medium text-red-600" role="alert">
                {budgetError}
              </p>
            )}
            <Button type="submit" className="mt-4">
              Find my fit →
            </Button>
          </form>

          {hasQuery && !hasError && persona !== null && (
            <section className="mt-10" aria-live="polite">
              <h2 className="text-xl font-semibold">{heading}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{persona.mappingNote}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {persona.description} {PERSONA_FIT_SCORING_NOTE}
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  Share these results:
                </span>
                <ShareButtons
                  title={heading}
                  text={`${heading} — SmartBuy AI`}
                />
              </div>
              {matches !== null && (
                <div className="mt-4">
                  <SaveCalculationButton
                    tool="persona-fit"
                    label={heading.slice(0, 100)}
                    params={{
                      ...(persona ? { persona: persona.id } : {}),
                      ...(effectiveBudgetUsd !== null ? { budget: effectiveBudgetUsd } : {}),
                    }}
                  />
                </div>
              )}

              {matches !== null && matches.length === 0 && (
                <div className="mt-6">
                  <EmptyState
                    eyebrow="No fit found"
                    title={
                      effectiveBudgetUsd !== null
                        ? `No ${persona.label} fit under $${effectiveBudgetUsd.toFixed(2)}`
                        : `No ${persona.label} fit in the catalog`
                    }
                    description="No product with a recorded price fits this persona’s category within your budget right now — the catalog is small and no specs are recorded yet. Try a higher budget or a different persona."
                    action={
                      <Link
                        href="/tools/persona-fit"
                        className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                      >
                        Clear and try again
                      </Link>
                    }
                  />
                </div>
              )}

              {matches !== null && matches.length > 0 && (
                <div className="mt-6 space-y-4">
                  {matches.map((match, i) => (
                    <article key={match.slug} className="rounded-lg border p-6">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            #{i + 1}
                            {match.verdict ? ` · ${match.verdict}` : ' · Category fit'}
                          </p>
                          <h3 className="mt-1 text-lg font-semibold">
                            <Link
                              href={`/products/${match.slug}`}
                              className="underline-offset-4 hover:underline"
                            >
                              {match.name}
                            </Link>
                          </h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {match.brand ?? 'Unknown brand'}
                            {match.category ? ` · ${match.category}` : ''}
                          </p>
                        </div>
                        <div className="text-right">
                          {match.priceUsd !== null ? (
                            <p className="text-xl font-bold">
                              ${match.priceUsd.toFixed(2)}
                            </p>
                          ) : (
                            <p className="text-sm font-medium text-muted-foreground">
                              Price not recorded
                            </p>
                          )}
                          <div className="mt-1">
                            <StalePriceBadge dataFreshness={match.dataFreshness} />
                          </div>
                        </div>
                      </div>
                      <p className="mt-3 text-sm text-muted-foreground">
                        {match.score.scorePct !== null
                          ? `Persona score ${match.score.scorePct}/100 — category fit only.`
                          : 'No score could be computed — nothing judgeable was recorded.'}{' '}
                        {PERSONA_FIT_SCORING_NOTE}
                      </p>
                      {match.score.matched.length > 0 && (
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                          {match.score.matched.map((entry) => (
                            <li key={entry.requirement.id}>
                              {entry.requirement.label}: {entry.actual}
                            </li>
                          ))}
                        </ul>
                      )}
                      {match.score.unknown.length > 0 && (
                        <p className="mt-2 text-sm text-muted-foreground">
                          Not recorded yet:{' '}
                          {match.score.unknown.map((u) => u.requirement.label).join(', ')} —{' '}
                          scored as unknown, never guessed.
                        </p>
                      )}
                      <Link
                        href={`/products/${match.slug}`}
                        className="mt-4 inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                      >
                        View product →
                      </Link>
                    </article>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    Ranked by persona score, then lowest recorded price.
                    The score counts category fit only until specs are
                    recorded — it is not a fit percentage.
                  </p>
                </div>
              )}
            </section>
          )}

          {hasQuery && !hasError && persona === null && (
            <p className="mt-8 text-sm text-muted-foreground">
              Pick a persona above to see its matches.
            </p>
          )}

          {!hasQuery && (
            <p className="mt-8 text-sm text-muted-foreground">
              Tip: try{' '}
              <Link
                href="/tools/persona-fit?persona=student&budget=1000"
                className="underline underline-offset-4"
              >
                Student picks under $1,000
              </Link>{' '}
              or{' '}
              <Link
                href="/tools/persona-fit?persona=creator&budget=1500"
                className="underline underline-offset-4"
              >
                Creator picks under $1,500
              </Link>
              .
            </p>
          )}
          <RelatedTools tool="persona-fit" productSlug={parseToolParams(searchParams).productSlug} />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
