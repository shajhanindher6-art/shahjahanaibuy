/**
 * Section 15, W6C — C3 i18n expansion + C4 per-tool metadata coverage.
 *
 * Static source tests in the Section 12/13 trust style: the tool
 * pages and dashboard components import the React site header /
 * footer, so they are not imported here — their wiring is asserted
 * by reading the source files as text. No database, no network.
 *
 * C4 finding (verified 2026-11-12): the audit's "15 tools need a
 * layout.tsx" count was stale. All 25 tool pages ALREADY carry
 * per-tool metadata — 15 client pages via a layout.tsx with a
 * metadata export, 10 server pages via `export const metadata` in
 * the page itself — each with title, description, canonical and
 * Open Graph. Creating 15 new layouts would have overwritten the
 * 15 existing ones (or duplicated the 10 page-level exports), so
 * no new layout file was created; this test locks in the coverage
 * instead. app/tools/coupons-cashback is the C1 worker's new tool
 * and is out of scope here (it has its own page-level metadata).
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

function readSource(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

function exists(rel: string): boolean {
  return fs.existsSync(path.join(process.cwd(), rel));
}

/** slug -> DictKey used for its h1, and the old hardcoded h1 text. */
const TOOL_HEADINGS: Array<[string, string, string]> = [
  ['best-time-calendar', 'toolHeadingBestTime', ' /> Best time to buy'],
  ['budget-finder', 'toolHeadingBudgetFinder', ' /> Budget Finder'],
  ['currency-converter', 'toolHeadingCurrencyConverter', ' /> Currency Converter'],
  ['coupons-cashback', 'toolHeadingCouponsCashback', 'Coupons &amp; Cashback\n            Finder'],
  ['deal-checker', 'toolHeadingDealChecker', ' /> Deal Checker'],
  ['eco-coach', 'toolHeadingEcoCoach', 'AI Eco Shopping Coach</h1>'],
  ['emi-calculator', 'toolHeadingEmiCalculator', ' /> EMI Calculator'],
  ['expense-tracker', 'toolHeadingExpenseTracker', 'Expense tracker</h1>'],
  ['forecast-explainer', 'toolHeadingForecastExplainer', ' /> Forecast Explainer'],
  ['future-you-planner', 'toolHeadingFutureYou', ' /> Future You planner'],
  ['gift-splitter', 'toolHeadingGiftSplitter', ' /> Gift Budget Splitter'],
  ['help-me-choose', 'toolHeadingHelpMeChoose', ' /> Help me choose'],
  ['landed-cost', 'toolHeadingLandedCost', ' /> Landed Cost Calculator'],
  ['list-optimizer', 'toolHeadingListOptimizer', ' /> Shopping list optimizer'],
  ['monthly-planner', 'toolHeadingMonthlyPlanner', ' /> Monthly shopping planner'],
  ['price-alert-simulator', 'toolHeadingPriceAlertSimulator', ' /> Price Alert Simulator'],
  ['price-drop-digest', 'toolHeadingPriceDropDigest', ' /> Price-drop digest'],
  ['price-history', 'toolHeadingPriceHistory', ' /> Price History Explorer'],
  ['price-protection', 'toolHeadingPriceProtection', ' /> Price Protection Check'],
  ['product-qa', 'toolHeadingProductQa', ' /> AI Product Q&amp;A'],
  ['savings-dashboard', 'toolHeadingSavingsDashboard', ' /> Savings dashboard'],
  ['smart-home-agent', 'toolHeadingSmartHomeAgent', 'AI Smart Home Reorder Agent</h1>'],
  ['store-finder', 'toolHeadingStoreFinder', ' /> Store Finder'],
  ['subscription-manager', 'toolHeadingSubscriptionManager', 'Subscription manager</h1>'],
  ['trade-in-finder', 'toolHeadingTradeInFinder', ' /> Trade-in &amp; second-hand finder'],
  ['warranty-claim-helper', 'toolHeadingWarrantyHelper', 'AI Warranty Claim Helper</h1>'],
];

/** The 10 server-rendered tool pages (no 'use client'). */
const SERVER_TOOLS = [
  'budget-finder',
  'currency-converter',
  'deal-checker',
  'emi-calculator',
  'forecast-explainer',
  'gift-splitter',
  'landed-cost',
  'price-alert-simulator',
  'price-history',
  'price-protection',
  'coupons-cashback',
];

/** Dashboard component -> DictKey wired into it. */
const DASHBOARD_KEYS: Array<[string, string]> = [
  ['active-deals-section', 'commonPriceNotListed'],
  ['agent-hunts-card', 'commonCancel'],
  ['ai-chat-panel', 'dashAiAssistant'],
  ['ai-sidebar', 'commonSeeAll'],
  ['alert-health', 'dashAlertHealth'],
  ['buy-list-panel', 'dashBuyListEmpty'],
  ['data-export-card', 'dashDownloadData'],
  ['delete-account-card', 'dashDeleteAccount'],
  ['digest-grid', 'dashYourDigest'],
  ['digest-snapshot-card', 'dashWeeklyDigest'],
  ['drops-to-watch-section', 'dashNoDropsSimulated'],
  ['external-items-manager', 'dashAddFromStore'],
  ['getting-started-checklist', 'commonSave'],
  ['landed-cost-widget', 'dashNoTrackedProducts'],
  ['lists-at-a-glance', 'dashListsAtAGlance'],
  ['price-protection-panel', 'dashNoProtectionWatches'],
  ['push-self-test', 'dashPushSelfTest'],
  ['recent-activity-feed', 'dashRecentActivity'],
  ['referral-card', 'dashReferralLink'],
  ['savings-history', 'dashSavingsHistory'],
  ['savings-widget', 'dashNoSavings'],
  ['tech-budget-widget', 'dashTechBudget'],
  ['upcoming-deals-section', 'dashNoUpcomingDeals'],
  ['watched-price-summary', 'dashNoPriceDrops'],
  ['webhook-channels-card', 'dashWebhookAlerts'],
];

const PRODUCT_KEYS = [
  'productAiSummary',
  'productPros',
  'productCons',
  'productAlternatives',
  'productPriceHistory',
  'productPriceDropPrediction',
  'productReviews',
  'productSpecifications',
];

describe('C3 — every tool page renders its heading through tFor', () => {
  it('covers all 26 tools (coupons-cashback added in Section 16, #44)', () => {
    expect(TOOL_HEADINGS).toHaveLength(26);
    for (const [slug, key, oldH1] of TOOL_HEADINGS) {
      const src = readSource(`app/tools/${slug}/page.tsx`);
      expect(src, `${slug} heading`).toContain(`tFor(language, '${key}')`);
      expect(src, `${slug} hardcoded h1`).not.toContain(oldH1);
    }
  });

  it('client pages resolve language from useRegion', () => {
    for (const [slug] of TOOL_HEADINGS) {
      if (SERVER_TOOLS.includes(slug)) continue;
      const src = readSource(`app/tools/${slug}/page.tsx`);
      expect(src, slug).toContain("import { useRegion } from '@/components/region/region-provider'");
      expect(src, slug).toContain('const { language } = useRegion();');
    }
  });

  it('server pages resolve language from the sb-language cookie (homepage pattern)', () => {
    for (const slug of SERVER_TOOLS) {
      const src = readSource(`app/tools/${slug}/page.tsx`);
      expect(src, slug).toContain("cookies().get('sb-language')");
      expect(src, slug).toContain('const language = toolLanguage();');
      expect(src, slug).toContain("export const dynamic = 'force-dynamic'");
    }
  });

  it('shared labels are wired where the exact copy exists', () => {
    expect(readSource('app/tools/help-me-choose/page.tsx')).toContain(
      "tFor(language, 'commonTryAgain')"
    );
    expect(readSource('app/tools/list-optimizer/page.tsx')).toContain(
      "tFor(language, 'commonRemove')"
    );
    expect(readSource('app/tools/subscription-manager/page.tsx')).toContain(
      "tFor(language, 'commonRemove')"
    );
  });
});

describe('C3 — dashboard components render headings / empty states through tFor', () => {
  it('covers 25 of 26 components with their key', () => {
    expect(DASHBOARD_KEYS).toHaveLength(25);
    for (const [file, key] of DASHBOARD_KEYS) {
      const src = readSource(`components/dashboard/${file}.tsx`);
      expect(src, file).toContain(`tFor(language, '${key}')`);
    }
  });

  it('animated-stat has no translatable strings (numbers only) — nothing to wire', () => {
    const src = readSource('components/dashboard/animated-stat.tsx');
    expect(src).not.toContain('tFor(');
    // The component renders only icon / label / value / subtext props.
    expect(src).toContain('AnimatedStat');
  });
});

describe('C3 — product detail renders section headings through tFor', () => {
  it('covers the 8 section headings', () => {
    const src = readSource('components/products/product-detail-client.tsx');
    for (const key of PRODUCT_KEYS) {
      expect(src, key).toContain(`tFor(language, '${key}')`);
    }
  });
});

describe('C4 — per-tool metadata is present for all 26 tools', () => {
  function metadataSource(slug: string): string {
    // Client pages carry metadata in layout.tsx; server pages export
    // it from page.tsx. Either location counts; both is duplication.
    const layout = `app/tools/${slug}/layout.tsx`;
    const page = `app/tools/${slug}/page.tsx`;
    if (exists(layout)) return readSource(layout);
    return readSource(page);
  }

  it('every tool has title, description, canonical and Open Graph metadata', () => {
    for (const [slug] of TOOL_HEADINGS) {
      const src = metadataSource(slug);
      expect(src, `${slug} metadata export`).toContain('export const metadata');
      expect(src, `${slug} title`).toContain('title:');
      expect(src, `${slug} description`).toContain('description:');
      expect(src, `${slug} canonical`).toContain('canonical:');
      expect(src, `${slug} canonical path`).toContain(`/tools/${slug}`);
      expect(src, `${slug} openGraph`).toContain('openGraph:');
      expect(src, `${slug} twitter`).toContain('twitter:');
    }
  });

  it('the 15 client tools carry metadata in layout.tsx (pages cannot, they are use client)', () => {
    const withLayout = TOOL_HEADINGS.filter(([slug]) =>
      exists(`app/tools/${slug}/layout.tsx`)
    ).map(([slug]) => slug);
    expect(withLayout).toHaveLength(15);
    for (const slug of withLayout) {
      expect(readSource(`app/tools/${slug}/page.tsx`)).toContain("'use client'");
    }
  });

  it('the 10 server tools carry metadata in page.tsx (no layout needed)', () => {
    for (const slug of SERVER_TOOLS) {
      expect(exists(`app/tools/${slug}/layout.tsx`), slug).toBe(false);
      expect(readSource(`app/tools/${slug}/page.tsx`)).toContain(
        'export const metadata'
      );
    }
  });
});
