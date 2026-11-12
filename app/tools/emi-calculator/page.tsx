/**
 * EMI / Installment Calculator — /tools/emi-calculator (Section 14).
 *
 * Price + annual interest rate + tenure (months) → monthly
 * installment, total payable, and total interest, using the
 * standard reducing-balance EMI formula.
 *
 * Server component, no JavaScript needed: the form submits as a
 * plain GET to this same page (?price=…&rate=…&months=…), so the
 * result URL is shareable. Pure math lives in lib/emi-calculator.ts.
 *
 * Honesty: the interest rate is USER-ENTERED ONLY — no rate is
 * preset, and no bank table exists here. The result is arithmetic
 * only, not a loan offer, and excludes fees, taxes, and processing
 * charges, which vary by lender.
 */

import { cookies } from 'next/headers';
import { isSupportedLanguage, type Language } from '@/lib/region';
import { tFor } from '@/lib/i18n';
import type { Metadata } from 'next';
import { Calculator } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { Button } from '@/components/ui/button';
import { ShareButtons } from '@/components/products/share-buttons';
import { appConfig } from '@/lib/config/app';
import { calculateEmi, parseEmiParams } from '@/lib/emi-calculator';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'EMI Calculator — SmartBuy AI',
  description:
    'Monthly installment, total payable, and total interest for any price, at the interest rate your lender quoted. No rate is preset — you enter it.',
  alternates: {
    canonical: `${appConfig.url}/tools/emi-calculator`,
  },
  openGraph: {
    title: 'EMI Calculator — SmartBuy AI',
    description:
      'Monthly installment, total payable, and total interest for any price, at the interest rate your lender quoted. No rate is preset — you enter it.',
    url: `${appConfig.url}/tools/emi-calculator`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'EMI Calculator — SmartBuy AI',
    description:
      'Monthly installment, total payable, and total interest for any price, at the interest rate your lender quoted. No rate is preset — you enter it.',
  },
};

interface EmiCalculatorProps {
  searchParams: {
    price?: string | string[];
    rate?: string | string[];
    months?: string | string[];
  };
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

export default function EmiCalculatorPage({ searchParams }: EmiCalculatorProps) {
  const language = toolLanguage();
  const { price, rate, months, errors, hasQuery } =
    parseEmiParams(searchParams);
  const result =
    price !== null && rate !== null && months !== null
      ? calculateEmi(price, rate, months)
      : null;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Calculator className="h-7 w-7 text-blue-600" /> {tFor(language, 'toolHeadingEmiCalculator')}
          </h1>
          <p className="mt-2 text-muted-foreground">
            Buying on installments? Enter the price, the annual interest
            rate your lender quoted, and the tenure — and see the monthly
            installment, the total you would pay, and the total interest.
            No interest rate is preset here: you enter the rate, because
            only your lender&apos;s quote applies to you. This is
            arithmetic, not a loan offer, and it excludes fees, taxes,
            and processing charges.
          </p>

          <form
            method="get"
            action="/tools/emi-calculator"
            className="mt-8 rounded-lg border p-6"
          >
            <div className="grid gap-4 sm:grid-cols-3">
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
                  defaultValue={price !== null ? String(price) : ''}
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
                  defaultValue={rate !== null ? String(rate) : ''}
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
                  defaultValue={months !== null ? String(months) : ''}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
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
              Calculate EMI →
            </Button>
          </form>

          {result !== null && (
            <section className="mt-10" aria-live="polite">
              <h2 className="text-xl font-semibold">Your installment plan</h2>
              <p className="mt-3 text-3xl font-bold">
                ${result.monthlyEmi.toFixed(2)}
                <span className="text-base font-normal text-muted-foreground">
                  {' '}
                  / month
                </span>
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                ${result.principal.toFixed(2)} over {result.tenureMonths}{' '}
                month{result.tenureMonths === 1 ? '' : 's'} at{' '}
                {result.annualRatePercent}% per year (the rate you
                entered).
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-md bg-muted p-3">
                  <dt className="text-muted-foreground">Total payable</dt>
                  <dd className="mt-1 font-semibold">
                    ${result.totalPayable.toFixed(2)}
                  </dd>
                </div>
                <div className="rounded-md bg-muted p-3">
                  <dt className="text-muted-foreground">Total interest</dt>
                  <dd className="mt-1 font-semibold">
                    ${result.totalInterest.toFixed(2)}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">
                Reducing-balance EMI, calculated from the price, rate,
                and tenure you entered. Actual installments depend on
                your lender&apos;s terms, fees, and charges — confirm
                with them before committing.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  Share this calculation:
                </span>
                <ShareButtons
                  title="EMI Calculator — SmartBuy AI"
                  text={`$${result.principal.toFixed(2)} over ${result.tenureMonths} months at ${result.annualRatePercent}%: $${result.monthlyEmi.toFixed(2)}/month — SmartBuy AI`}
                />
              </div>
            </section>
          )}

          {!hasQuery && (
            <p className="mt-8 text-sm text-muted-foreground">
              Tip: try $999 at 12% per year over 12 months — the
              installment is ≈ $88.76/month.
            </p>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
