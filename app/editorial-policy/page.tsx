import Link from 'next/link';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { appConfig } from '@/lib/config/app';

export default function EditorialPolicyPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-3xl font-bold">Editorial Policy</h1>
          <p className="mt-2 text-muted-foreground">
            How SmartBuy AI&apos;s blog is written, checked, and corrected — and who writes
            it. Last updated November 10, 2026.
          </p>

          <h2 className="mt-8 text-xl font-semibold">Who writes the blog</h2>
          <p className="mt-3 text-muted-foreground">
            Every article on the SmartBuy blog is written by the SmartBuy Editorial Team — a
            generic byline used for all posts. No individual author name, biography, or
            photograph is published, because none has been confirmed, and this site does not
            invent people. If named authors or expert reviewers are added in future, this
            page will say who they are and what they reviewed.
          </p>

          <h2 className="mt-8 text-xl font-semibold">Expert review process</h2>
          <p className="mt-3 text-muted-foreground">
            Every article is checked before publication in three steps. First, every price,
            percentage, and date in the article is traced to verified SmartBuy data — the
            catalog, the recorded price history, the deals table, or the coupons table — or
            it is labelled as an example or an estimate. Second, the article is read against
            the site itself: if the site shows an honest empty state for a product, the
            article says the same thing instead of filling the gap. Third, the article is
            checked for the claims SmartBuy never makes — no live retailer prices, no exact
            future price or date, no guaranteed saving, no fake review, no invented local
            price, and no affiliate or partnership claim.
          </p>
          <p className="mt-4 text-muted-foreground">
            Articles are written in English. The rest of the site works in eight languages,
            but blog content is English only, and it is not machine-translated and presented
            as native copy.
          </p>

          <h2 className="mt-8 text-xl font-semibold">What we never publish</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
            <li>Fake reviews, invented ratings, or testimonial quotes presented as real.</li>
            <li>Prices presented as live retailer prices. Catalog prices are always framed as &ldquo;as shown on SmartBuy&rdquo;.</li>
            <li>Local prices, stock states, deals, or coupons that are not in the site&apos;s own data.</li>
            <li>Exact future prices or dates, guaranteed savings, or predictions presented as certainties.</li>
            <li>Sponsored product placements presented as editorial recommendations. SmartBuy does not publish any.</li>
          </ul>

          <h2 className="mt-8 text-xl font-semibold">Corrections policy</h2>
          <p className="mt-3 text-muted-foreground">
            If a price, a figure, or a fact in an article is wrong, we correct it and we say
            so. A corrected article keeps its original publication date and gains a
            &ldquo;last updated&rdquo; date showing when the correction was made. Small
            corrections — a typo, a clarified sentence — are fixed silently. Factual
            corrections are noted in the article itself where the change affects what a
            reader would decide.
          </p>
          <p className="mt-4 text-muted-foreground">
            To report an error, email{' '}
            <a href={`mailto:${appConfig.supportEmail}`} className="underline">
              {appConfig.supportEmail}
            </a>{' '}
            or use the{' '}
            <Link href="/contact" className="underline">
              contact page
            </Link>
            , with the article title and the sentence you believe is wrong. We check every
            report against the site&apos;s data before changing anything, and we do not
            remove an article because a reader disagrees with its conclusion — only because
            its facts are wrong.
          </p>

          <h2 className="mt-8 text-xl font-semibold">Updates</h2>
          <p className="mt-3 text-muted-foreground">
            Prices and site data change, so articles are reviewed when the data they rely on
            changes — for example, when a coupon expires, a deal ends, or a product&apos;s
            recorded history grows. An article whose figures are out of date is updated with
            a new &ldquo;last updated&rdquo; date, not quietly rewritten. Articles that
            describe how a feature works are updated when the feature changes.
          </p>

          <h2 className="mt-8 text-xl font-semibold">Affiliate disclosure</h2>
          <p className="mt-3 text-muted-foreground">
            SmartBuy earns a commission when you buy through some retailer links, at no
            extra cost to you. Affiliate links never change what the blog recommends or how
            a Deal Score is calculated, and the blog never presents an affiliate
            relationship as an endorsement. The full disclosure is on the{' '}
            <Link href="/methodology" className="underline">
              methodology page
            </Link>
            .
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
