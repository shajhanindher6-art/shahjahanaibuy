import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'About — SmartBuy AI',
  description:
    'What SmartBuy AI is, what it does, and how it works — honest price tracking, deal scores, and reviews from real people only.',
  alternates: {
    canonical: `${appConfig.url}/about`,
  },
};

export default function AboutPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-3xl font-bold">About SmartBuy AI</h1>
          <p className="mt-4 text-muted-foreground">
            SmartBuy AI helps shoppers make confident decisions. It brings together product
            search, price tracking across retailers, price-drop alerts, and AI-powered
            recommendations, summaries, and price predictions in one place.
          </p>
          <p className="mt-4 text-muted-foreground">
            Instead of checking many stores one by one, you can compare products, follow the
            prices you care about, and get alerted when a deal is worth acting on.
          </p>

          <h2 className="mt-8 text-xl font-semibold">Our mission</h2>
          <p className="mt-3 text-muted-foreground">
            Shopping online should not feel like a gamble. Prices move, discounts are not
            always what they seem, and the information a shopper needs is scattered across
            dozens of stores. SmartBuy AI exists to put that information in one place —
            honestly. When we know something, we show it with its source. When we do not
            know it, we say so instead of guessing.
          </p>
          <p className="mt-4 text-muted-foreground">
            That honesty is the whole product. A price history that only covers thirty days
            says so. A product with no reviews says &ldquo;no reviews yet&rdquo; instead of
            inventing praise. An estimate is labelled an estimate, a simulation is labelled
            a simulation, and a demo price is never presented as a live retailer price.
          </p>

          <h2 className="mt-8 text-xl font-semibold">What you can do here</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
            <li>Search products in plain language and compare up to five at once.</li>
            <li>Track prices over time and set alerts for price drops.</li>
            <li>Save products to wishlists and follow your favourite deals.</li>
            <li>Get AI recommendations based on what you have viewed and saved.</li>
            <li>Read buying guides written from SmartBuy&apos;s own recorded data.</li>
            <li>Check the true cost of a purchase — including duty, tax, and shipping — before you order across a border.</li>
          </ul>

          <h2 className="mt-8 text-xl font-semibold">How we work</h2>
          <p className="mt-3 text-muted-foreground">
            SmartBuy AI is built and run as an independent project. Prices are tracked on a
            six-hour refresh schedule, deal scores are computed from recorded price history
            with a published method, and reviews are only ever shown when real people have
            written them. How each of those works is explained in plain language on the{' '}
            <Link href="/methodology" className="underline">
              methodology page
            </Link>
            .
          </p>
          <p className="mt-4 text-muted-foreground">
            The site works in 20 languages and across 61 regions, with local stores
            listed by directory and link — never with invented local prices. What is
            recorded is shown; what is not recorded is shown as missing, not filled in.
          </p>

          <h2 className="mt-8 text-xl font-semibold">Who builds SmartBuy AI</h2>
          <p className="mt-3 text-muted-foreground">
            SmartBuy AI is an independent project by its founder, who builds in the open on
            GitHub as{' '}
            <a
              href="https://github.com/shajhanindher6-art"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              shajhanindher6-art
            </a>
            . The project&apos;s public repository is{' '}
            <a
              href="https://github.com/shajhanindher6-art/shahjahanaibuy"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              shahjahanaibuy
            </a>
            .
          </p>
          <p className="mt-4 text-muted-foreground">
            No team members are listed here, because none have been confirmed — this page
            will only ever name people who are actually part of the project. For press,
            screenshots, and facts about the site, see the{' '}
            <Link href="/press" className="underline">
              press page
            </Link>
            . For questions or corrections,{' '}
            <Link href="/contact" className="underline">
              contact us
            </Link>
            .
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
