/**
 * Currency Converter — /tools/currency-converter (Section 13).
 *
 * Convert an arbitrary amount between any two of the 51 supported
 * currencies (e.g. $999 → PKR). The FX table already powers region
 * prices, but no page ever converted an amount — this is that page.
 *
 * Server component, no JavaScript needed: the form submits as a
 * plain GET to this same page (?amount=…&from=…&to=…), so the
 * result URL is shareable. Conversion is the pure helper in
 * lib/currency-converter.ts over services/currency.ts.
 *
 * Honesty: rates are APPROXIMATE static rates, reviewed
 * 2026-11-01/02 — never a live feed. Every result is labelled
 * "≈" with that review date, and the page never claims a live or
 * real-time rate.
 */

import { cookies } from 'next/headers';
import { isSupportedLanguage, type Language } from '@/lib/region';
import { tFor } from '@/lib/i18n';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeftRight } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { Button } from '@/components/ui/button';
import { ShareButtons } from '@/components/products/share-buttons';
import { appConfig } from '@/lib/config/app';
import {
  convertCurrency,
  formatConvertedAmount,
  parseConverterParams,
  RATES_NOTE,
  SUPPORTED_CURRENCIES,
} from '@/lib/currency-converter';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Currency Converter — SmartBuy AI',
  description:
    'Convert any amount between 51 currencies — for example $999 to PKR. Approximate static rates, reviewed 2026-11-01/02, never a live rate.',
  alternates: {
    canonical: `${appConfig.url}/tools/currency-converter`,
  },
  openGraph: {
    title: 'Currency Converter — SmartBuy AI',
    description:
      'Convert any amount between 51 currencies — for example $999 to PKR. Approximate static rates, reviewed 2026-11-01/02, never a live rate.',
    url: `${appConfig.url}/tools/currency-converter`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Currency Converter — SmartBuy AI',
    description:
      'Convert any amount between 51 currencies — for example $999 to PKR. Approximate static rates, reviewed 2026-11-01/02, never a live rate.',
  },
};

interface CurrencyConverterProps {
  searchParams: {
    amount?: string | string[];
    from?: string | string[];
    to?: string | string[];
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

export default function CurrencyConverterPage({ searchParams }: CurrencyConverterProps) {
  const language = toolLanguage();
  const { amount, from, to, amountError } = parseConverterParams(searchParams);
  const result = amount !== null ? convertCurrency(amount, from, to) : null;
  const hasQuery = amount !== null;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <ArrowLeftRight className="h-7 w-7 text-blue-600" /> {tFor(language, 'toolHeadingCurrencyConverter')}
          </h1>
          <p className="mt-2 text-muted-foreground">
            Convert any amount between 51 currencies — handy when a
            price is listed in one currency and you think in another.
            {RATES_NOTE}
          </p>

          <form
            method="get"
            action="/tools/currency-converter"
            className="mt-8 rounded-lg border p-6"
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="amount" className="text-sm font-medium">
                  Amount
                </label>
                <input
                  id="amount"
                  name="amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="e.g. 999"
                  defaultValue={amount !== null ? String(amount) : ''}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="from" className="text-sm font-medium">
                  From
                </label>
                <select
                  id="from"
                  name="from"
                  defaultValue={from}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  {SUPPORTED_CURRENCIES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="to" className="text-sm font-medium">
                  To
                </label>
                <select
                  id="to"
                  name="to"
                  defaultValue={to}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  {SUPPORTED_CURRENCIES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {amountError && (
              <p className="mt-3 text-sm font-medium text-red-600" role="alert">
                {amountError}
              </p>
            )}
            <Button type="submit" className="mt-4">
              Convert →
            </Button>
          </form>

          {result !== null && (
            <section className="mt-10" aria-live="polite">
              <h2 className="text-xl font-semibold">Result</h2>
              <p className="mt-3 text-3xl font-bold">
                ≈ {formatConvertedAmount(result.converted, result.to)}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {formatConvertedAmount(result.amount, result.from)} ≈{' '}
                {formatConvertedAmount(result.converted, result.to)} · 1{' '}
                {result.from} ≈ {result.rate.toLocaleString('en-US', { maximumFractionDigits: 6 })}{' '}
                {result.to}
                {result.from !== 'USD' && result.to !== 'USD'
                  ? ` · ≈ $${result.usdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} in between`
                  : ''}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">{RATES_NOTE}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  Share this conversion:
                </span>
                <ShareButtons
                  title="Currency Converter — SmartBuy AI"
                  text={`${formatConvertedAmount(result.amount, result.from)} ≈ ${formatConvertedAmount(result.converted, result.to)} — SmartBuy AI`}
                />
              </div>
            </section>
          )}

          {!hasQuery && (
            <p className="mt-8 text-sm text-muted-foreground">
              Tip: try{' '}
              <Link
                href="/tools/currency-converter?amount=999&from=USD&to=PKR"
                className="underline underline-offset-4"
              >
                $999 → PKR
              </Link>{' '}
              or{' '}
              <Link
                href="/tools/currency-converter?amount=500&from=EUR&to=GBP"
                className="underline underline-offset-4"
              >
                €500 → GBP
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
