/**
 * AI Price-Match Finder — /tools/price-match (T3).
 *
 * Which stores offer price matching, what each policy says, and
 * how to claim it.
 *
 * Data: the store directory (lib/store-directory.ts) + curated
 * policy summaries in lib/price-match-policies.ts, each written
 * ONLY from the retailer's own public policy page, read at build
 * time, with a source URL and a "last reviewed" stamp.
 *
 * Honesty: the directory starts with only the policies verified
 * at build time (7 stores); every other store reads "Not recorded
 * yet". Marketplace sellers read "Varies by seller". Nothing is
 * guessed, and a price match is never promised — a match is
 * always the retailer's decision under its current terms.
 *
 * Server component, no JavaScript needed: the status filter is a
 * plain GET form.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { BadgePercent } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { RelatedTools } from '@/components/tools/related-tools';
import { parseToolParams } from '@/services/tool-integration';
import { appConfig } from '@/lib/config/app';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { getAllStorePages } from '@/lib/store-directory';
import {
  PRICE_MATCH_DISCLAIMER,
  PRICE_MATCH_FILTERS,
  PRICE_MATCH_LAST_REVIEWED,
  PRICE_MATCH_POLICIES,
  PRICE_MATCH_STATUS_LABELS,
  filterPriceMatchRows,
  parsePriceMatchFilter,
  priceMatchRowsForStores,
  type PriceMatchFilter,
  type PriceMatchStatus,
} from '@/lib/price-match-policies';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AI Price-Match Finder — SmartBuy AI',
  description:
    'Which stores offer price matching, what each policy says, and how to claim it. Curated summaries from each retailer\u2019s own policy page — never a promised match.',
  alternates: {
    canonical: `${appConfig.url}/tools/price-match`,
  },
  openGraph: {
    title: 'AI Price-Match Finder — SmartBuy AI',
    description:
      'Which stores offer price matching, what each policy says, and how to claim it. Curated summaries from each retailer\u2019s own policy page — never a promised match.',
    url: `${appConfig.url}/tools/price-match`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'AI Price-Match Finder — SmartBuy AI',
    description:
      'Which stores offer price matching, what each policy says, and how to claim it. Curated summaries from each retailer\u2019s own policy page — never a promised match.',
  },
};

const FILTER_LABELS: Record<PriceMatchFilter, string> = {
  all: 'All stores',
  yes: 'Matches competitor prices',
  limited: 'Own prices only',
  no: 'Does not price-match',
  varies: 'Varies by seller',
  'not-recorded': 'Not recorded yet',
};

const STATUS_BADGE_CLASS: Record<PriceMatchStatus, string> = {
  yes: 'bg-emerald-100 text-emerald-800',
  no: 'bg-red-100 text-red-800',
  limited: 'bg-amber-100 text-amber-800',
  varies: 'bg-sky-100 text-sky-800',
};

interface PriceMatchPageProps {
  searchParams: { status?: string | string[] };
}

export default async function PriceMatchFinderPage({
  searchParams,
}: PriceMatchPageProps) {
  const filter = parsePriceMatchFilter(searchParams);

  // Unique store names across the 84-store directory (eBay, Noon,
  // Daraz and others repeat per country). Amazon and Best Buy are
  // priced merchants, not directory stores — they appear in the
  // verified-policies section below, not in this list.
  const directoryNames = getAllStorePages().map((entry) => entry.store.name);
  const allRows = priceMatchRowsForStores(directoryNames);
  const rows = filterPriceMatchRows(allRows, filter);
  const recordedCount = allRows.filter((r) => r.policy !== null).length;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <PageJsonLd
        name="AI Price-Match Finder"
        description="Which stores offer price matching, what each policy says, and how to claim it. Curated summaries from each retailer’s own policy page — never a promised match."
        path="/tools/price-match"
        crumbs={[
          { name: 'Home', path: '/' },
          { name: 'AI tools', path: '/tools' },
          { name: 'AI Price-Match Finder' },
        ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <BadgePercent className="h-7 w-7 text-blue-600" /> AI Price-Match Finder
          </h1>
          <p className="mt-2 text-muted-foreground">
            Which stores offer price matching, what each policy says,
            and how to claim it. Each summary below was written from
            that retailer&apos;s own public policy page — not from a
            roundup or a guess.
          </p>
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {PRICE_MATCH_DISCLAIMER} Policies change, and a match is
            never guaranteed: the retailer decides on the day, under
            its current terms. SmartBuy never promises that a price
            match will be granted, and never quotes a matched price.
          </p>

          <form
            method="get"
            action="/tools/price-match"
            className="mt-8 rounded-lg border p-6"
          >
            <label htmlFor="status" className="text-sm font-medium">
              Show stores
            </label>
            <select
              id="status"
              name="status"
              defaultValue={filter}
              className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              {PRICE_MATCH_FILTERS.map((f) => (
                <option key={f} value={f}>
                  {FILTER_LABELS[f]}
                </option>
              ))}
            </select>
            <Button type="submit" className="mt-4">
              Filter →
            </Button>
          </form>

          <section aria-labelledby="verified-policies" className="mt-10">
            <h2 id="verified-policies" className="text-xl font-semibold">
              Verified policies
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {PRICE_MATCH_POLICIES.length} policies verified from the
              retailers&apos; own pages, last reviewed{' '}
              {PRICE_MATCH_LAST_REVIEWED}. Every other store in the
              directory reads &ldquo;Not recorded yet&rdquo; below.
            </p>
            <div className="mt-4 space-y-4">
              {PRICE_MATCH_POLICIES.map((policy) => (
                <article key={policy.store} className="rounded-lg border p-6">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-lg font-semibold">{policy.store}</h3>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[policy.status]}`}
                    >
                      {PRICE_MATCH_STATUS_LABELS[policy.status]}
                    </span>
                  </div>
                  <p className="mt-2 text-sm">{policy.summary}</p>
                  <p className="mt-2 text-sm">
                    <span className="font-medium">How to claim: </span>
                    {policy.howToClaim}
                  </p>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Source:{' '}
                    <a
                      href={policy.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline-offset-4 hover:underline"
                    >
                      {policy.domain} — retailer&apos;s own policy page
                    </a>{' '}
                    · Last reviewed {policy.lastReviewed}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section aria-labelledby="store-directory" className="mt-10">
            <h2 id="store-directory" className="text-xl font-semibold">
              Full store directory
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {recordedCount} of {allRows.length} directory stores have
              a recorded policy. Amazon and Best Buy are priced
              merchants rather than directory stores — their policies
              are in the verified section above.
            </p>

            {rows.length === 0 ? (
              <div className="mt-6">
                <EmptyState
                  eyebrow="No stores match"
                  title="No stores match this filter"
                  description="Try a different filter — for example, “All stores” lists every store in the directory."
                />
              </div>
            ) : (
              <ul className="mt-4 space-y-3">
                {rows.map((row) => (
                  <li
                    key={row.store}
                    className="flex flex-wrap items-start justify-between gap-2 rounded-lg border p-4"
                  >
                    <div>
                      <p className="font-medium">{row.store}</p>
                      {row.policy ? (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {row.policy.summary}
                        </p>
                      ) : (
                        <p className="mt-1 text-sm text-muted-foreground">
                          Not recorded yet — no price-match policy has
                          been verified from this store&apos;s own
                          pages.
                        </p>
                      )}
                    </div>
                    {row.policy ? (
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[row.policy.status]}`}
                      >
                        {PRICE_MATCH_STATUS_LABELS[row.policy.status]}
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        Not recorded yet
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-xs text-muted-foreground">
              Found a lower price at a store whose policy is not
              recorded here? Check that retailer&apos;s own help pages
              before buying — SmartBuy will not guess a policy for
              you.
            </p>
          </section>

          <p className="mt-8 text-sm">
            <Link href="/stores" className="underline-offset-4 hover:underline">
              Browse all stores →
            </Link>{' '}
            ·{' '}
            <Link href="/tools" className="underline-offset-4 hover:underline">
              All AI tools →
            </Link>
          </p>
          <RelatedTools tool="price-match" productSlug={parseToolParams(searchParams).productSlug} />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
