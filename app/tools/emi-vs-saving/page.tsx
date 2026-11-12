/**
 * EMI vs Save-Then-Buy Comparator — /tools/emi-vs-saving
 * (Section 16, E7).
 *
 * One product price, both paths side by side: total EMI cost
 * (with interest) vs saving monthly and buying outright.
 *
 * Server component, no JavaScript needed: the form submits as a
 * plain GET to this same page
 * (?price=…&rate=…&months=…&saving=…), so the comparison URL is
 * shareable. EMI math is lib/emi-calculator.ts; saving-plan math
 * is lib/future-you.ts, composed by lib/emi-vs-saving.ts.
 *
 * Honesty: the interest rate is USER-ENTERED ONLY (no preset, no
 * bank table) and the result is arithmetic, not a loan offer —
 * fees, taxes, and processing charges are excluded. When no
 * monthly saving is entered, the saving path saves the EMI
 * installment itself each month — the same monthly outflow, two
 * different outcomes — and the page says so.
 */

import type { Metadata } from 'next';
import { Scale } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { SiteFooter } from '@/components/layout/site-footer';
import { Button } from '@/components/ui/button';
import { appConfig } from '@/lib/config/app';
import { compareEmiVsSaving, parseEmiVsSavingParams } from '@/lib/emi-vs-saving';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'EMI vs Save-Then-Buy Comparator — SmartBuy AI',
  description:
    'One price, both paths side by side: total EMI cost with interest vs saving monthly and buying outright. Same monthly outflow, honest arithmetic only.',
  alternates: {
    canonical: `${appConfig.url}/tools/emi-vs-saving`,
  },
  openGraph: {
    title: 'EMI vs Save-Then-Buy Comparator — SmartBuy AI',
    description:
      'One price, both paths side by side: total EMI cost with interest vs saving monthly and buying outright. Same monthly outflow, honest arithmetic only.',
    url: `${appConfig.url}/tools/emi-vs-saving`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'EMI vs Save-Then-Buy Comparator — SmartBuy AI',
    description:
      'One price, both paths side by side: total EMI cost with interest vs saving monthly and buying outright. Same monthly outflow, honest arithmetic only.',
  },
};

interface EmiVsSavingProps {
  searchParams: {
    price?: string | string[];
    rate?: string | string[];
    months?: string | string[];
    saving?: string | string[];
  };
}

export default function EmiVsSavingPage({ searchParams }: EmiVsSavingProps) {
  const params = parseEmiVsSavingParams(searchParams);
  const comparison =
    params.price !== null && params.rate !== null && params.months !== null
      ? compareEmiVsSaving({
          price: params.price,
          annualRatePercent: params.rate,
          tenureMonths: params.months,
          monthlySavingUsd: params.saving,
        })
      : null;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 17: page-level JSON-LD (WebPage + BreadcrumbList). */}
      <PageJsonLd
        name="EMI vs Save-Then-Buy Comparator"
        description="One price, both paths side by side: total EMI cost with interest vs saving monthly and buying outright. Same monthly outflow, honest arithmetic only."
        path="/tools/emi-vs-saving"
        crumbs={[ { name: "Home", path: "/" }, { name: "AI tools", path: "/tools" }, { name: "EMI vs Save-Then-Buy Comparator" } ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Scale className="h-7 w-7 text-blue-600" /> EMI vs Save-Then-Buy Comparator
          </h1>
          <p className="mt-2 text-muted-foreground">
            Same price, two ways to pay for it: installments now, or
            save each month and buy outright later. Enter the price,
            the annual interest rate your lender quoted, and the
            tenure — and see both totals side by side. No interest
            rate is preset here: you enter the rate, because only
            your lender&apos;s quote applies to you.
          </p>

          <form
            method="get"
            action="/tools/emi-vs-saving"
            className="mt-8 rounded-lg border p-6"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="price" className="text-sm font-medium">
                  Price (USD)
                </label>
                <input
                  id="price"
                  name="price"
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="e.g. 999"
                  defaultValue={params.price !== null ? String(params.price) : ''}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="rate" className="text-sm font-medium">
                  Annual interest rate (%) — you enter it
                </label>
                <input
                  id="rate"
                  name="rate"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="e.g. 12"
                  defaultValue={params.rate !== null ? String(params.rate) : ''}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="months" className="text-sm font-medium">
                  Tenure (months)
                </label>
                <input
                  id="months"
                  name="months"
                  type="number"
                  min="1"
                  max="360"
                  step="1"
                  inputMode="numeric"
                  placeholder="e.g. 12"
                  defaultValue={params.months !== null ? String(params.months) : ''}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="saving" className="text-sm font-medium">
                  Monthly saving (USD) — optional
                </label>
                <input
                  id="saving"
                  name="saving"
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="Blank = save the EMI amount"
                  defaultValue={params.saving !== null ? String(params.saving) : ''}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
            {params.errors.length > 0 && (
              <div className="mt-3" role="alert">
                {params.errors.map((e) => (
                  <p key={e} className="text-sm font-medium text-red-600">
                    {e}
                  </p>
                ))}
              </div>
            )}
            <Button type="submit" className="mt-4">
              Compare →
            </Button>
          </form>

          {comparison !== null && (
            <section className="mt-10" aria-live="polite">
              <h2 className="text-xl font-semibold">Both paths, side by side</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <article className="rounded-lg border p-6">
                  <h3 className="font-semibold">EMI — buy now, pay monthly</h3>
                  <p className="mt-3 text-3xl font-bold">
                    ${comparison.emi.monthlyEmi.toFixed(2)}
                    <span className="text-base font-normal text-muted-foreground">
                      {' '}
                      / month
                    </span>
                  </p>
                  <dl className="mt-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Total payable</dt>
                      <dd className="font-semibold">
                        ${comparison.emi.totalPayable.toFixed(2)}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Total interest</dt>
                      <dd className="font-semibold">
                        ${comparison.emi.totalInterest.toFixed(2)}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">You own it</dt>
                      <dd className="font-semibold">Now</dd>
                    </div>
                  </dl>
                </article>
                <article className="rounded-lg border p-6">
                  <h3 className="font-semibold">Save-then-buy — pay outright later</h3>
                  <p className="mt-3 text-3xl font-bold">
                    ${comparison.monthlySavingUsd.toFixed(2)}
                    <span className="text-base font-normal text-muted-foreground">
                      {' '}
                      / month saved
                    </span>
                  </p>
                  <dl className="mt-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Total paid</dt>
                      <dd className="font-semibold">
                        ${comparison.savingTotalUsd.toFixed(2)}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Interest paid</dt>
                      <dd className="font-semibold">$0.00</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">You own it after</dt>
                      <dd className="font-semibold">
                        {comparison.monthsToSave} month
                        {comparison.monthsToSave === 1 ? '' : 's'}
                      </dd>
                    </div>
                  </dl>
                </article>
              </div>
              <p className="mt-4 text-sm font-medium">{comparison.verdict}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Reducing-balance EMI, calculated from the price, rate,
                and tenure you entered; the saving path is the same
                monthly amount saved until it covers the price.
                Actual installments depend on your lender&apos;s terms,
                fees, and charges — confirm with them before
                committing. This is arithmetic, not a loan offer.
              </p>
            </section>
          )}

          {!params.hasQuery && (
            <p className="mt-8 text-sm text-muted-foreground">
              Tip: try $999 at 12% per year over 12 months — EMI is ≈
              $88.76/month ($1,065.12 total); saving $88.76/month
              buys it outright after 12 months for $999, saving
              $66.12 of interest.
            </p>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
