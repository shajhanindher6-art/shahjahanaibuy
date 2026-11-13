import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/layout/site-header';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { SiteFooter } from '@/components/layout/site-footer';
import { appConfig } from '@/lib/config/app';
import { getConfiguredAmazonLocales } from '@/services/affiliate-geo';
import { DEAL_VERIFIED_MEANING } from '@/lib/fact-check';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'How SmartBuy AI works — SmartBuy AI',
  description:
    'Methodology in plain language: where prices come from, how the Deal Score is calculated, how reviews are verified, and how SmartBuy AI earns money.',
  alternates: {
    canonical: `${appConfig.url}/methodology`,
  },
};

/**
 * The affiliate disclosure reads the live configuration at request
 * time, not a build-time snapshot: a static prerender would bake in
 * whichever env the build ran with, so the page would keep saying
 * "no tag configured" after the owner sets one (or the reverse).
 * Same source of truth as /status (services/platform-status.ts).
 */
export const dynamic = 'force-dynamic';

export default async function MethodologyPage() {
  const configuredLocales = getConfiguredAmazonLocales();
  // Section 19, Phase 7 (§12 #75): the "last recorded" date used to
  // be hardcoded here ("2 November 2026") and went stale the day
  // after it was written. It is now read live from the catalog —
  // the newest products.data_freshness — at request time, the same
  // source the owner dashboard's price-source health reads. When
  // the read fails (or no freshness stamp exists) the date is
  // omitted entirely instead of a stale one being shown.
  let latestFreshness: string | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('products')
      .select('data_freshness')
      .not('data_freshness', 'is', null)
      .order('data_freshness', { ascending: false })
      .limit(1);
    if (!error && data?.[0]) {
      latestFreshness = (data[0] as { data_freshness: string }).data_freshness;
    }
  } catch {
    latestFreshness = null;
  }
  const latestFreshnessLabel = latestFreshness
    ? new Date(latestFreshness).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 14: page-level JSON-LD (WebPage + BreadcrumbList). */}
      <PageJsonLd
        name="How SmartBuy AI works"
        description="Methodology in plain language: where prices come from, how the Deal Score is calculated, how reviews are verified, and how SmartBuy AI earns money."
        path="/methodology"
        crumbs={[ { name: "Home", path: "/" }, { name: "How SmartBuy AI works" } ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-3xl font-bold">How SmartBuy AI works</h1>
          <p className="mt-2 text-muted-foreground">
            Our methodology, in plain language: where prices come from, how the Deal Score
            is calculated, how reviews are verified, and how we earn money. No jargon, no
            hidden steps.
          </p>

          <h2 className="mt-8 text-xl font-semibold">Where prices come from</h2>
          <p className="mt-3 text-muted-foreground">
            Prices on SmartBuy come from the site&apos;s own catalog of merchant listings —
            currently Amazon and Best Buy for the products listed. A price refresh is
            scheduled every six hours, but no live refresh happens today: the scheduled
            run re-reads the site&apos;s own database and fetches no new retailer prices,
            so the recorded prices are stale
            {latestFreshnessLabel ? (
              <> (last recorded {latestFreshnessLabel})</>
            ) : (
              <> (no recorded freshness stamp is available right now)</>
            )}{' '}
            until the live refresh work lands. Every price shown carries the time it was last
            recorded.
            The recorded price history for most products currently spans about thirty days
            (about 30 days ending when the catalog was seeded); a ninety-day history is still accumulating, and
            any feature that needs ninety days says so honestly instead of pretending the
            history exists.
          </p>
          <p className="mt-4 text-muted-foreground">
            Prices in the catalog are the site&apos;s recorded figures. They are not live
            retailer prices: the retailer sets the final price on its own page, and it can
            change between our refresh and your visit. Always check the retailer&apos;s page
            before you buy. Local stores — for example Daraz in Pakistan — are shown as
            directory entries with a link only. SmartBuy never invents a local price, a
            stock state, or a local deal.
          </p>

          <h2 className="mt-8 text-xl font-semibold">How the Deal Score is calculated</h2>
          <p className="mt-3 text-muted-foreground">
            The Deal Score is a number from 0 to 100 shown on product pages. It is computed
            from the product&apos;s real recorded data: the discount probability, the
            lowest and current recorded prices, and the confidence of the prediction. The
            score is clamped to the 0–100 range, and it is only shown where there is enough
            recorded history to compute it.
          </p>
          <p className="mt-4 text-muted-foreground">
            <strong className="text-foreground">
              Discount percentages use the merchant compare-at price as their basis.
            </strong>{' '}
            When a product page says a price is 9% off, it means 9% below the merchant&apos;s
            own compare-at price for that listing — the percentage is always measured
            against the compare-at price shown on that product page, never against a
            price from another listing. No fixed product-and-price example is given
            here: catalog prices change, and a printed example would go stale the
            moment the catalog does. The homepage deals widget uses a different
            basis (the deals table), which is why its percentages can differ from the
            product page for the same product. We state the basis here so the difference is
            a known fact, not a surprise.
          </p>
          <p className="mt-4 text-muted-foreground">
            Related guidance follows the same honest rules. Buy vs Wait gives a confidence
            score from the number of recorded price points — never an exact future price or
            date. The drop-window simulator is labelled simulated, not a forecast. The
            resale predictor is labelled simulated, not a resale quote.
          </p>

          <h2 className="mt-8 text-xl font-semibold">How reviews are verified</h2>
          <p className="mt-3 text-muted-foreground">
            Reviews on SmartBuy come only from real people who write them on the site.
            SmartBuy has no real reviews today — zero — and the review sections say so
            plainly instead of inventing review counts, quotes, or ratings.
          </p>
          <p className="mt-4 text-muted-foreground">
            When reviews do arrive, two rules apply. First, a review is only shown as
            verified when the reviewer&apos;s purchase has been confirmed; unverified
            reviews are never presented as if they were verified, and verified reviews get
            priority in the summary. Second, the review-authenticity check only raises a
            badge when there are at least ten reviews and the signals are genuinely
            present — below that threshold, the honest answer is that there is not enough
            to judge. Sentiment is analysed by a deterministic engine (no language model,
            no invented summary) that reads what reviewers actually wrote.
          </p>
          <p className="mt-4 text-muted-foreground">
            The same standard applies to community deals: a deal is only marked Verified
            by an admin confirmation or by a merchant-price match within 5%. Upvotes never
            verify a deal, and no seed or fake deals or votes exist on the site.
          </p>

          <h2 className="mt-8 text-xl font-semibold">What a &ldquo;Verified&rdquo; deal means</h2>
          <p className="mt-3 text-muted-foreground">{DEAL_VERIFIED_MEANING}</p>

          <h2 className="mt-8 text-xl font-semibold">Estimates, simulations, and missing data</h2>
          <p className="mt-3 text-muted-foreground">
            Some figures on SmartBuy are estimates or simulations, and they are always
            labelled as such. The landed-cost calculator is an estimate, not a customs
            quote — duty uses a clearly labelled 10% placeholder where no real schedule is
            available. The tax estimator is an estimate only. Eco footprints are either
            recorded values or labelled estimates, never mixed. Where data is missing —
            product specifications, a warranty, a repairability score — the page shows an
            honest empty state, never an invented value.
          </p>

          <h2 id="affiliate-disclosure" className="mt-8 text-xl font-semibold">Affiliate disclosure</h2>
          <p className="mt-3 text-muted-foreground">
            SmartBuy earns a commission when you buy through some of the retailer links on
            the site, at no extra cost to you. Affiliate tags come only from the site&apos;s
            own configuration — they are never hardcoded in the code, and no tag is ever
            invented here.
            {configuredLocales.length > 0 ? (
              <>
                {' '}
                An affiliate tag is configured for: {configuredLocales.join(', ')}. Retailer
                links for those locales carry the configured tag, so a purchase through
                them may earn the site a commission. This page states only that a tag is
                configured — whether it belongs to an approved Associates account is a
                fact of the account dashboard, not of this page.
              </>
            ) : (
              <>
                {' '}
                No affiliate tag is currently configured, so the site earns no affiliate
                commission today and the retailer links are plain links until a tag is set
                in configuration.
              </>
            )}{' '}
            Clicks are counted for reporting, but SmartBuy does not track your browsing,
            and it never sells or shares personal data with retailers. Affiliate links
            never change which products are recommended or how a Deal Score is calculated.
          </p>
          <p className="mt-4 text-muted-foreground">
            SmartBuy does not accept payment from retailers to rank their products higher,
            and it does not publish sponsored product placements. If that ever changes, it
            will be disclosed here first.
          </p>

          <h2 className="mt-8 text-xl font-semibold">Questions or corrections</h2>
          <p className="mt-3 text-muted-foreground">
            If you spot a price, a figure, or a claim on this site that looks wrong, tell us
            through the{' '}
            <Link href="/contact" className="underline">
              contact page
            </Link>{' '}
            with the product name and the link, and we will check it. Corrections to the
            blog follow the same rule and are published openly — see the{' '}
            <Link href="/editorial-policy" className="underline">
              editorial policy
            </Link>
            .
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
