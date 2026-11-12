/**
 * AI tools hub — /tools.
 *
 * Links only: this page lists the 13 buildable Section 7 AI tools
 * plus the 3 Section 11 tools (help-me-choose, budget-finder,
 * store-finder), the 4 Section 13 tools (price-history,
 * gift-splitter, forecast-explainer, currency-converter) and the
 * 5 Section 14 tools (price-alert-simulator, deal-checker,
 * landed-cost, price-protection, emi-calculator) and links out to
 * each tool's own /tools/* page. No tool logic lives here — every
 * tool is built (or honestly marked not ready) on its own page.
 * The 7 blocked Section 7 items (recall, review summarizer, size &
 * fit, photo authenticity, voice shopping, video summaries, family
 * shopper) are NOT listed: each is blocked on missing data or a
 * missing dependency, and this hub never links to a tool that does
 * not exist yet.
 *
 * Chrome (Section 14, I-4): the language-dependent strings render
 * in components/tools/tools-hub-content.tsx via the toolsHub* dict
 * keys; tool names/descriptions stay English. ItemList JSON-LD for
 * the hub is emitted below (Section 14, Chunk 6).
 */

import { appConfig } from '@/lib/config/app';
import { buildToolsItemListJsonLd, toJsonLd } from '@/lib/json-ld';
import type { DictKey } from '@/lib/i18n';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { ToolsHubContent } from '@/components/tools/tools-hub-content';

const TOOL_GROUPS: Array<{
  headingKey: DictKey;
  tools: Array<{ name: string; href: string; description: string; isNew?: boolean }>;
}> = [
  {
    headingKey: 'toolsHubGroupEveryday',
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
        name: 'Price History Explorer',
        href: '/tools/price-history',
        description:
          'Every product’s recorded 30-day price history side by side: biggest drop, now vs low, high and average. Recorded points only — never smoothed.',
        isNew: true,
      },
      {
        name: 'Gift Budget Splitter',
        href: '/tools/gift-splitter',
        description:
          'Split one gift budget across several people, with one real priced gift pick per person. Equal shares unless you set your own weights.',
        isNew: true,
      },
      {
        name: 'Forecast Explainer',
        href: '/tools/forecast-explainer',
        description:
          'What a price forecast range really means, in plain language — and how often past forecasts were right, with the trial count shown honestly.',
        isNew: true,
      },
      {
        name: 'Currency Converter',
        href: '/tools/currency-converter',
        description:
          'Convert any amount between 51 currencies — for example $999 to PKR. Approximate static rates, reviewed 2026-11-01/02, never a live rate.',
        isNew: true,
      },
      {
        name: 'Price Alert Simulator',
        href: '/tools/price-alert-simulator',
        description:
          'Pick a product and a target price — see whether that price was already met, has been recorded before, or has never been recorded. Recorded prices only, no predictions, and it creates no real alert.',
        isNew: true,
      },
      {
        name: 'Deal Checker',
        href: '/tools/deal-checker',
        description:
          'Found a price somewhere? Check it against recorded prices — real deal, cheaper than current, not a deal, or cannot verify. Recorded prices only, no invented data.',
        isNew: true,
      },
      {
        name: 'Landed Cost Calculator',
        href: '/tools/landed-cost',
        description:
          'Estimate the full landed cost of an import — price, shipping, duty and VAT — from rates you enter yourself. An estimate, never an official duty figure.',
        isNew: true,
      },
      {
        name: 'Price Protection Check',
        href: '/tools/price-protection',
        description:
          'Bought something and the price dropped after? Check whether a lower price was recorded inside your protection window. No sign-in needed — and it cannot promise a refund.',
        isNew: true,
      },
      {
        name: 'EMI Calculator',
        href: '/tools/emi-calculator',
        description:
          'Monthly installment, total payable, and total interest for any price, at the interest rate your lender quoted. No rate is preset — you enter it.',
        isNew: true,
      },
      {
        name: 'Price Volatility Ranking',
        href: '/tools/volatility-ranking',
        description:
          'Which products hold a steady price and which jump around? Ranked by price stability from recorded price history only — standard deviation, range %, and a stability label per product.',
        isNew: true,
      },
      {
        name: 'Catalog Freshness Dashboard',
        href: '/tools/catalog-freshness',
        description:
          'How fresh is the data behind SmartBuy? A public per-product table: last recorded price date, price age in days, history points, and missing image or GTIN flags.',
        isNew: true,
      },
      {
        name: 'API Quota & Tier Calculator',
        href: '/tools/api-quota-calculator',
        description:
          'Enter your expected API calls per day — get the tier you need, the headroom on it, and the next tier up. Planned prices labelled honestly, never as purchasable.',
        isNew: true,
      },
      {
        name: 'Deal Score Breakdown Explorer',
        href: '/tools/deal-score-breakdown',
        description:
          'What is behind a product’s Deal Score? Term-by-term numbers — drop-chance term, price term, confidence term — summing to the displayed score, from the real prediction inputs.',
        isNew: true,
      },
      // Section 16, E5–E9 + E11 (P2 tools) — another chunk owns E1–E4 above.
      {
        name: 'Store Trust Checker',
        href: '/tools/store-trust-checker',
        description:
          'Pick any of the 84 stores and see its trust grade (A–D) with recorded evidence — or an honest "Not enough data" listing the policy facts still missing.',
        isNew: true,
      },
      {
        name: 'Inflation-Adjusted (Real-Price) Converter',
        href: '/tools/real-price-converter',
        description:
          'Enter an amount and a category to see what it is worth in today’s recorded prices, from the category inflation index (trailing 90 days, recorded prices only).',
        isNew: true,
      },
      {
        name: 'EMI vs Save-Then-Buy Comparator',
        href: '/tools/emi-vs-saving',
        description:
          'One price, both paths side by side: total EMI cost with interest vs saving monthly and buying outright. Same monthly outflow, honest arithmetic only.',
        isNew: true,
      },
      {
        name: 'Smart Target-Price Picker',
        href: '/tools/target-price-picker',
        description:
          'Pick a product and get target prices suggested from its recorded price history — recorded low, low recorded point, last price — each with how often it was seen.',
        isNew: true,
      },
      {
        name: 'Gift Occasion Planner',
        href: '/tools/gift-occasions',
        description:
          'Plan upcoming gift occasions with dates and budgets — a dated plan with lead time and one priced catalog pick per occasion. Shown on this page only; no reminders are sent.',
        isNew: true,
      },
      {
        name: 'Cheapest Store by Category',
        href: '/tools/cheapest-store-by-category',
        description:
          'Which store has the lowest recorded price in each category? An honest two-store comparison from recorded prices only — Amazon vs Best Buy, product named behind every low.',
        isNew: true,
      },
      {
        name: 'Coupons & Cashback Finder',
        href: '/tools/coupons-cashback',
        description:
          'Find coupon codes and cashback offers by store and category. Demo / seed data — sample offers from the demo catalog, not live merchant offers.',
        isNew: true,
      },
      {
        name: 'AI Shopping List Optimizer',
        href: '/tools/list-optimizer',
        description:
          'Your whole list, cheapest way: which item to buy from which store, with the total and the saving — recorded prices only.',
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
    headingKey: 'toolsHubGroupMoney',
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
    headingKey: 'toolsHubGroupTrust',
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
    headingKey: 'toolsHubGroupFuture',
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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: toJsonLd(
            buildToolsItemListJsonLd(
              appConfig.url,
              TOOL_GROUPS.flatMap((g) =>
                g.tools.map((t) => ({ name: t.name, path: t.href }))
              )
            )
          ),
        }}
      />
      <ToolsHubContent groups={TOOL_GROUPS} />
      <SiteFooter />
    </div>
  );
}
