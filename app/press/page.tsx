/**
 * Press fact sheet (Section 9, chunk 4).
 *
 * Every number below traces to a repo fact or a real run — see
 * tests/press-status.test.ts, which locks the derived counts
 * (stores, regions, languages, currencies, blog articles) to their
 * source modules so a future change fails loudly instead of leaving
 * this page stale. The test count is rendered from
 * lib/generated/press-counts.json (Section 16, item 7): that JSON is
 * written by `npm run generate:press-counts` from a real `npx
 * vitest run` and committed, so the page never hardcodes the totals
 * again — hardcoding drifted twice (1,752 -> 1,754 -> 2,197 ->
 * 2,206). `npm run check:press-counts` (CI) fails while the JSON is
 * stale. The product count is 10: the catalog holds 11 rows, but the
 * `sample-laptop` row is a database health-check row excluded from
 * every public surface (services/products.ts, Section 10 fix), so
 * the public catalog — and this page — counts 10.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { appConfig } from '@/lib/config/app';
import pressCounts from '@/lib/generated/press-counts.json';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Press — SmartBuy AI',
  description:
    'Press fact sheet for SmartBuy AI: real figures about the catalog, stores, regions, languages, and automated tests.',
  alternates: {
    canonical: `${appConfig.url}/press`,
  },
};

/**
 * The "last recorded" freshness date is read live at request time
 * (see buildFacts): a static prerender would bake in whichever
 * value the build ran with, so the page would keep showing a stale
 * date after the catalog refreshes.
 */
export const dynamic = 'force-dynamic';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "2026-11-12" -> "12 November 2026", the label the fact sheet renders. */
function formatPressCountsDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/**
 * Section 19, Phase 7 (§12 #75): FACTS is a builder, not a static
 * array, because the "last recorded" price date used to be hardcoded
 * here ("2 November 2026") and went stale the day after it was
 * written. It is now read live from the catalog (newest
 * products.data_freshness) at request time; when the read fails the
 * date clause is dropped instead of a stale date being shown.
 */
function buildFacts(latestFreshnessLabel: string | null): Array<[string, string]> {
  return [
  ['Live site', 'https://shahjahanaibuy-b1zp.vercel.app'],
  ['Products in the catalog', '10'],
  ['Merchant listings', '20'],
  ['Recorded price-history rows', '40'],
  ['Deals listed', '6'],
  ['Stores in the directory', '80 local stores (plus 4 global fallback stores — Amazon, eBay, AliExpress, Google Shopping — search links only)'],
  ['Regions covered', '61 (60 with a local store; South Africa uses the global fallback)'],
  ['Languages', '20 UI languages (167 interface strings translated; 12 of the 20 are machine-translated — all other content, including product pages and guides, stays English)'],
  ['Currencies', '51 (approximate static rates; live FX in the landed-cost calculator)'],
  ['Price refresh schedule', `Every 6 hours (scheduled — but no live refresh happens today: the scheduled run re-reads the site\u2019s own database and fetches no new retailer prices, so recorded prices stay stale until the live refresh work lands${latestFreshnessLabel ? `; last recorded ${latestFreshnessLabel}` : ''})`],
  // Section 12: the seed writes price history relative to the seed
  // run (now() - 30 days to now()), so no fixed calendar range is
  // published — a hardcoded date range goes stale the moment the
  // catalog is re-seeded.
  ['Recorded price history span', 'About 30 days (the 30 days before the catalog was seeded)'],
  ['Coupons listed', '2 — SAVE10 and BESTBUY15, both valid until January 29, 2027 (demo / seed data — sample offers from the SmartBuy demo catalog, not live merchant offers)'],
  ['Blog articles', '21 original English guides'],
  ['Database access policies (RLS)', 'RLS enabled on all tables'],
  ['Security headers', 'Nonce-based Content Security Policy'],
  // Section 16, item 7: rendered from lib/generated/press-counts.json
  // (written by `npm run generate:press-counts` from a real vitest
  // run) — never hardcode the totals here again; the check script
  // fails while the JSON is stale.
  ['Automated tests passing', `${pressCounts.tests.toLocaleString('en-US')} passing (${pressCounts.files} test files, full run ${formatPressCountsDate(pressCounts.date)})`],
  ['Founder', 'Independent developer, GitHub: shajhanindher6-art'],
  ['Public repository', 'https://github.com/shajhanindher6-art/shahjahanaibuy'],
  ];
}

export default async function PressPage() {
  let latestFreshnessLabel: string | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('products')
      .select('data_freshness')
      .not('data_freshness', 'is', null)
      .order('data_freshness', { ascending: false })
      .limit(1);
    if (!error && data?.[0]) {
      latestFreshnessLabel = new Date(
        (data[0] as { data_freshness: string }).data_freshness
      ).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    }
  } catch {
    latestFreshnessLabel = null;
  }
  const FACTS = buildFacts(latestFreshnessLabel);
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-3xl font-bold">Press</h1>
          <p className="mt-2 text-muted-foreground">
            Facts, assets, and contact details for journalists, bloggers, and anyone writing
            about SmartBuy AI. Every number below is a real figure from the live site as of
            November 2026 — nothing here is rounded up or estimated without a label.
          </p>

          <h2 className="mt-8 text-xl font-semibold">What SmartBuy AI is</h2>
          <p className="mt-3 text-muted-foreground">
            SmartBuy AI is an AI-powered shopping and price-tracking site. It tracks prices
            across retailers, alerts shoppers when a price drops, compares products side by
            side, and explains its own reasoning — including a published methodology for its
            Deal Score. It works across 61 regions, with its interface in
            20 languages, with local stores listed by directory and link, never with
            invented local prices.
          </p>

          <h2 className="mt-8 text-xl font-semibold">Fact sheet</h2>
          <dl className="mt-4 space-y-3">
            {FACTS.map(([label, value]) => (
              <div key={label} className="border-b pb-3 last:border-b-0">
                <dt className="text-sm font-medium">{label}</dt>
                <dd className="mt-0.5 text-sm text-muted-foreground">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm text-muted-foreground">
            Prices in the catalog are the site&apos;s recorded figures, not live retailer
            prices. See the{' '}
            <Link href="/methodology" className="underline">
              methodology page
            </Link>{' '}
            for how every number on this page is produced.
          </p>

          <h2 className="mt-8 text-xl font-semibold">Logo pack</h2>
          <p className="mt-3 text-muted-foreground">
            The SmartBuy AI app icons below are the site&apos;s own public assets. You are
            welcome to use them when writing about SmartBuy AI, at the sizes shown, without
            altering them.
          </p>
          <div className="mt-4 flex items-end gap-6">
            <figure className="text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon-192.png" alt="SmartBuy AI app icon, 192 pixels" width={96} height={96} />
              <figcaption className="mt-2 text-xs text-muted-foreground">
                <a href="/icon-192.png" className="underline">
                  icon-192.png
                </a>
              </figcaption>
            </figure>
            <figure className="text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon-512.png" alt="SmartBuy AI app icon, 512 pixels" width={128} height={128} />
              <figcaption className="mt-2 text-xs text-muted-foreground">
                <a href="/icon-512.png" className="underline">
                  icon-512.png
                </a>
              </figcaption>
            </figure>
          </div>

          <h2 className="mt-8 text-xl font-semibold">Screenshots</h2>
          <p className="mt-3 text-muted-foreground">
            There is no prepared screenshot pack yet. The live site itself is the best
            reference — visit{' '}
            <a
              href={appConfig.url}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              {appConfig.url}
            </a>{' '}
            and capture the pages you need. If you need a specific screenshot or a quote,
            contact us and we will provide it.
          </p>

          <h2 className="mt-8 text-xl font-semibold">Contact</h2>
          <p className="mt-3 text-muted-foreground">
            For press enquiries, corrections, or interview requests, email{' '}
            <a href={`mailto:${appConfig.supportEmail}`} className="underline">
              {appConfig.supportEmail}
            </a>{' '}
            or use the{' '}
            <Link href="/contact" className="underline">
              contact page
            </Link>
            . Please include your publication, your deadline, and what you need.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
