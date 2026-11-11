/**
 * AI tools hub — /tools.
 *
 * Links only: this page lists the 13 buildable Section 7 AI tools
 * plus the 3 Section 11 tools (help-me-choose, budget-finder,
 * store-finder) and links out to each tool's own /tools/* page. No
 * tool logic lives here — every tool is built (or honestly marked
 * not ready) on its own page.
 * The 7 blocked Section 7 items (recall, review summarizer, size &
 * fit, photo authenticity, voice shopping, video summaries, family
 * shopper) are NOT listed: each is blocked on missing data or a
 * missing dependency, and this hub never links to a tool that does
 * not exist yet.
 */

import Link from 'next/link';
import { Wrench } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';

const TOOL_GROUPS: Array<{
  heading: string;
  tools: Array<{ name: string; href: string; description: string; isNew?: boolean }>;
}> = [
  {
    heading: 'Everyday tools — AI that helps daily',
    tools: [
      {
        name: 'Help Me Choose — guided shopping quiz',
        href: '/tools/help-me-choose',
        description:
          'Not sure what to buy? Answer a few quick questions about what you need and what matters most, and get a shortlist from the catalog. Your answers travel in a shareable link, so you can send the quiz to someone else.',
        isNew: true,
      },
      {
        name: 'Budget Finder',
        href: '/tools/budget-finder',
        description:
          'Tell it what you want and the most you want to spend — it shows the best matches in the catalog under your budget, with real recorded prices only.',
        isNew: true,
      },
      {
        name: 'Store Finder',
        href: '/tools/store-finder',
        description:
          'Pick your country first and see which stores serve it. A directory only — it makes no shipping or delivery promises we cannot verify.',
        isNew: true,
      },
      {
        name: 'AI Shopping List Optimizer',
        href: '/tools/list-optimizer',
        description:
          'Your whole list, cheapest way: which item to buy from which store, with the total and the saving — real merchant prices only.',
      },
      {
        name: 'AI Receipt & Expense Tracker',
        href: '/tools/expense-tracker',
        description:
          'See what you spent, by category, each month — recorded when a purchase is confirmed, with an alert when you go over budget.',
      },
      {
        name: 'AI Subscription Manager',
        href: '/tools/subscription-manager',
        description:
          'Netflix, Spotify, and every other subscription in one place — renewal reminders, and a flag for duplicates or rarely used ones.',
      },
      {
        name: 'AI Monthly Shopping Planner',
        href: '/tools/monthly-planner',
        description:
          'Set a monthly budget and get a plan: what to buy now, what to wait on, and what to push to next month.',
      },
      {
        name: 'AI Product Q&A Assistant',
        href: '/tools/product-qa',
        description:
          'Ask a question, get an answer from recorded specs, reviews, and sentiment — always labelled “AI answer”, with its source.',
      },
    ],
  },
  {
    heading: 'Money-saving tools — savings you can see',
    tools: [
      {
        name: 'AI Savings Dashboard',
        href: '/tools/savings-dashboard',
        description:
          '“How much have you saved so far” — total saved, this month, and your biggest saving, from confirmed recorded savings only.',
      },
      {
        name: 'AI Best-Time-to-Buy Calendar',
        href: '/tools/best-time-calendar',
        description:
          'The best time of year to buy, per category, from recorded price history — ranges only, never a promised exact date.',
      },
      {
        name: 'AI Trade-in & Second-hand Finder',
        href: '/tools/trade-in-finder',
        description:
          'Sell the old one before buying new: real trade-in programs and certified refurbished listings, linked to your resale value.',
      },
      {
        name: 'AI Warranty Claim Helper',
        href: '/tools/warranty-claim-helper',
        description:
          'A step-by-step claim checklist from your Vault — documents, retailer or brand contact, and a reminder before expiry.',
      },
      {
        name: 'AI Price-Drop Digest',
        href: '/tools/price-drop-digest',
        description:
          'One daily or weekly summary of your watched products — top deals first, each with one line saying why it is good.',
      },
    ],
  },
  {
    heading: 'Trust, safety & health — AI that protects',
    tools: [
      {
        name: 'AI Eco Shopping Coach',
        href: '/tools/eco-coach',
        description:
          'A monthly carbon budget, with coach advice on each purchase — recorded carbon first, estimates always labelled as estimates.',
      },
    ],
  },
  {
    heading: 'Future AI — what comes next',
    tools: [
      {
        name: 'AI Smart Home Reorder Agent',
        href: '/tools/smart-home-agent',
        description:
          'Your home reorders itself: device triggers plus your reorder rules, with confirmation before every order.',
      },
      {
        name: 'AI “Future You” Planner',
        href: '/tools/future-you-planner',
        description:
          'A saving plan for big purchases — set a target and a date, and get a monthly plan, linked to price-drop alerts.',
      },
    ],
  },
];

export default function AiToolsHubPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Wrench className="h-7 w-7 text-blue-600" /> AI tools
          </h1>
          <p className="mt-2 text-muted-foreground">
            The AI tools that make SmartBuy useful every day — AI that
            builds your list, counts your spending, manages your
            subscriptions, answers your questions, and shows your savings.
            Each tool below has its own page; pick one to open it.
          </p>

          {TOOL_GROUPS.map((group) => (
            <section key={group.heading} className="mt-10">
              <h2 className="text-xl font-semibold">{group.heading}</h2>
              <div className="mt-4 space-y-4">
                {group.tools.map((tool) => (
                  <article key={tool.href} className="rounded-lg border p-6">
                    <h3 className="text-lg font-semibold">
                      <Link
                        href={tool.href}
                        className="underline-offset-4 hover:underline"
                      >
                        {tool.name}
                      </Link>{' '}
                      {tool.isNew ? (
                        <span className="ml-1 inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 align-middle text-xs font-semibold text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                          New
                        </span>
                      ) : null}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {tool.description}
                    </p>
                    <Link
                      href={tool.href}
                      className="mt-4 inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                    >
                      Open tool →
                    </Link>
                  </article>
                ))}
              </div>
            </section>
          ))}

          <p className="mt-8 text-sm text-muted-foreground">
            Some AI tools are still waiting on real data — recall alerts,
            review summaries, size and fit, photo checks, voice shopping,
            video summaries, and the family shopper. They are not listed
            here and will appear only once their data source exists.
          </p>

          {/* Roadmap hub (Section 11): what is coming next, with
              honest status per item and no fake dates. Separate
              from the "Future AI" group above, which lists tools
              that are already built. */}
          <div className="mt-8 rounded-lg border p-6">
            <h2 className="text-lg font-semibold">What&apos;s coming next</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The roadmap for tools still being built — what each one will
              do, and where it stands. No launch dates are promised until
              the work is real.
            </p>
            <Link
              href="/coming-soon"
              className="mt-4 inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              See the roadmap →
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
