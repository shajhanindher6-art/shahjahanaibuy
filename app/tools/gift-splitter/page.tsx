/**
 * Gift Budget Splitter — /tools/gift-splitter (Section 13).
 *
 * Split ONE total gift budget across MULTIPLE recipients, with one
 * catalog pick per recipient. Gift Finder is one recipient;
 * Bundle Allocator splits across categories — neither does this.
 *
 * Server component, no JavaScript needed: the form submits as a
 * plain GET to this same page (?total=…&name=…&name=…&weight=…
 * &interests=…&occasion=…). Up to 3 recipient rows are shown in
 * the form; the URL is shareable, so a shared link restores the
 * exact split. Picks come from services/gift-finder.ts
 * (findGiftPicks) over real priced products.
 *
 * Honesty: occasion is display-only (the catalog has no occasion
 * tagging); shares are EQUAL unless the user enters weights — no
 * weight is ever invented; a share that buys nothing gets an
 * honest "no priced gift fits" line, never a forced over-budget
 * pick.
 */

import { cookies } from 'next/headers';
import { isSupportedLanguage, type Language } from '@/lib/region';
import { tFor } from '@/lib/i18n';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Gift } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { ShareButtons } from '@/components/products/share-buttons';
import { appConfig } from '@/lib/config/app';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { loadGuidedCandidates } from '@/services/guided-finder';
import { SHIPPING_NOTE } from '@/services/gift-finder';
import {
  parseGiftSplitParams,
  splitGiftBudget,
  suggestPicksForSplit,
  validateGiftSplitInput,
} from '@/lib/gift-splitter';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Gift Budget Splitter — SmartBuy AI',
  description:
    'Split one gift budget across several people, with one real priced gift pick per person. Equal shares unless you set your own weights.',
  alternates: {
    canonical: `${appConfig.url}/tools/gift-splitter`,
  },
  openGraph: {
    title: 'Gift Budget Splitter — SmartBuy AI',
    description:
      'Split one gift budget across several people, with one real priced gift pick per person. Equal shares unless you set your own weights.',
    url: `${appConfig.url}/tools/gift-splitter`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Gift Budget Splitter — SmartBuy AI',
    description:
      'Split one gift budget across several people, with one real priced gift pick per person. Equal shares unless you set your own weights.',
  },
};

interface GiftSplitterProps {
  searchParams: {
    total?: string | string[];
    name?: string | string[];
    weight?: string | string[];
    interests?: string | string[];
    occasion?: string | string[];
  };
}

/** The form always shows 3 recipient rows (blank rows are ignored). */
const FORM_ROWS = 3;

/**
 * Section 15 (C3): the server reads the same sb-language cookie the
 * root layout and homepage use for dir/lang — a first-visit language
 * switch via localStorage takes effect on the next load.
 */
function toolLanguage(): Language {
  const saved = cookies().get('sb-language')?.value ?? null;
  return saved && isSupportedLanguage(saved) ? saved : 'en';
}

export default async function GiftSplitterPage({ searchParams }: GiftSplitterProps) {
  const language = toolLanguage();
  const { totalUsd, recipients, occasion, totalError } = parseGiftSplitParams(searchParams);
  const hasQuery = totalUsd !== null || recipients.length > 0;
  const inputError =
    totalError ??
    (hasQuery && totalUsd !== null ? validateGiftSplitInput(totalUsd, recipients) : null);

  const split =
    hasQuery && !inputError && totalUsd !== null
      ? splitGiftBudget(totalUsd, recipients)
      : null;

  const suggestions =
    split !== null
      ? suggestPicksForSplit(
          (await loadGuidedCandidates(await createSupabaseServerClient())).map((c) => ({
            ...c,
            couponLabel: null,
          })),
          split.shares
        )
      : null;

  const heading = occasion
    ? `Split your ${occasion} budget`
    : 'Split your gift budget';

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Gift className="h-7 w-7 text-blue-600" /> {tFor(language, 'toolHeadingGiftSplitter')}
          </h1>
          <p className="mt-2 text-muted-foreground">
            One total, several people: enter a budget and who it is
            for, and each person gets an equal share — or your own
            weights — plus one gift pick that fits that share. The
            occasion is just a label for the split; it does not change
            which gifts are picked, because the catalog has no
            occasion tagging.
          </p>

          <form
            method="get"
            action="/tools/gift-splitter"
            className="mt-8 rounded-lg border p-6"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="total" className="text-sm font-medium">
                  Total gift budget (USD)
                </label>
                <input
                  id="total"
                  name="total"
                  type="number"
                  min="1"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="e.g. 200"
                  defaultValue={totalUsd !== null ? String(totalUsd) : ''}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="occasion" className="text-sm font-medium">
                  Occasion (label only)
                </label>
                <input
                  id="occasion"
                  name="occasion"
                  type="text"
                  placeholder="e.g. Birthday"
                  defaultValue={occasion}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>

            <fieldset className="mt-6">
              <legend className="text-sm font-medium">
                Recipients — leave a row blank to skip it
              </legend>
              <p className="mt-1 text-xs text-muted-foreground">
                Weight is optional: leave it blank for an equal share,
                or enter a number (2 means twice the share of a
                weight-1 person).
              </p>
              <div className="mt-3 space-y-3">
                {Array.from({ length: FORM_ROWS }, (_, i) => (
                  <div key={i} className="grid gap-2 sm:grid-cols-3">
                    <input
                      name="name"
                      type="text"
                      aria-label={`Recipient ${i + 1} name`}
                      placeholder={`Recipient ${i + 1} name`}
                      defaultValue={recipients[i]?.name ?? ''}
                      className="min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                    />
                    <input
                      name="weight"
                      type="number"
                      min="0.01"
                      step="0.01"
                      inputMode="decimal"
                      aria-label={`Recipient ${i + 1} weight (blank = equal)`}
                      placeholder="Weight (blank = equal)"
                      defaultValue={
                        recipients[i]?.weight !== null && recipients[i]?.weight !== undefined
                          ? String(recipients[i].weight)
                          : ''
                      }
                      className="min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                    />
                    <input
                      name="interests"
                      type="text"
                      aria-label={`Recipient ${i + 1} interests`}
                      placeholder="Interests, e.g. laptop"
                      defaultValue={(recipients[i]?.interests ?? []).join(', ')}
                      className="min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                    />
                  </div>
                ))}
              </div>
            </fieldset>

            {inputError && (
              <p className="mt-3 text-sm font-medium text-red-600" role="alert">
                {inputError}
              </p>
            )}
            <Button type="submit" className="mt-4">
              Split the budget →
            </Button>
          </form>

          {split !== null && suggestions !== null && (
            <section className="mt-10" aria-live="polite">
              <h2 className="text-xl font-semibold">{heading}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Total ${split.totalUsd.toFixed(2)} ·{' '}
                {split.isEqualSplit
                  ? 'equal shares'
                  : 'shares by the weights you entered'}
                . Shares always add up to the total, to the cent.
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  Share this split:
                </span>
                <ShareButtons
                  title={`${heading} — SmartBuy AI`}
                  text={`${heading}: $${split.totalUsd.toFixed(2)} across ${split.shares.length} people. — SmartBuy AI`}
                />
              </div>

              <div className="mt-6 space-y-4">
                {suggestions.map(({ share, pick }) => (
                  <article key={share.name} className="rounded-lg border p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-lg font-semibold">{share.name}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {share.interests.length > 0
                            ? `Interests: ${share.interests.join(', ')}`
                            : 'No interests given'}
                          {share.isEqualSplit ? '' : ` · weight ${share.weightUsed}`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold">${share.shareUsd.toFixed(2)}</p>
                        <p className="text-xs text-muted-foreground">share</p>
                      </div>
                    </div>

                    {pick ? (
                      <>
                        <p className="mt-3 text-sm">
                          <Link
                            href={`/products/${pick.slug}`}
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {pick.name}
                          </Link>{' '}
                          — ${(pick.bestPriceUsd as number).toFixed(2)}
                          {pick.merchantName ? ` at ${pick.merchantName}` : ''}
                          {pick.savingPct !== null ? ` · save ${pick.savingPct}%` : ''}
                        </p>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                          {pick.why.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                        <Link
                          href={`/products/${pick.slug}`}
                          className="mt-4 inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                        >
                          View gift →
                        </Link>
                      </>
                    ) : (
                      <p className="mt-3 text-sm text-muted-foreground">
                        No priced gift fits a ${share.shareUsd.toFixed(2)} share
                        right now — the catalog is small. Try a larger
                        total or a different split.
                      </p>
                    )}
                  </article>
                ))}
              </div>
              <p className="mt-6 text-xs text-muted-foreground">{SHIPPING_NOTE}</p>
            </section>
          )}

          {hasQuery && split === null && !inputError && (
            <div className="mt-6">
              <EmptyState
                eyebrow="Nothing to split yet"
                title="Enter a total and at least one recipient"
                description="Add a total budget above $0 and name at least one recipient, then split the budget."
              />
            </div>
          )}

          {!hasQuery && (
            <p className="mt-8 text-sm text-muted-foreground">
              Tip: try{' '}
              <Link
                href="/tools/gift-splitter?total=200&name=Ayesha&name=Bilal&name=Chen"
                className="underline underline-offset-4"
              >
                $200 across three people
              </Link>{' '}
              — each gets $66.67, $66.67 and $66.66.
            </p>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
