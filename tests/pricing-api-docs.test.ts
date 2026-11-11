/**
 * Section 12, chunk C — monetization readiness.
 *
 * Source-level locks (no DB, no network), following the
 * tests/section10-polish.test.ts pattern: each assertion reads the
 * file the feature lives in, so a future regression fails loudly
 * here instead of silently shipping. The quota numbers are checked
 * against the real constants in lib/api-quota.ts (the live
 * enforcement), and the tier data against lib/tiers.ts — never
 * against numbers typed into this test. Behavioural checks (the
 * pages actually rendering in a browser) belong to the headless /
 * live recheck, not this file.
 *
 * Note on apostrophes: JSX text in this repo writes them as the
 * &apos; entity (react/no-unescaped-entities), so source-level
 * assertions match the entity form, e.g. "aren&apos;t" — the
 * rendered page still reads "aren't".
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TIERS, getTier } from '@/lib/tiers';
import { ANONYMOUS_DAILY_QUOTA, API_QUOTAS } from '@/lib/api-quota';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const exists = (rel: string) => existsSync(join(process.cwd(), rel));

describe('Section 12 — pricing page', () => {
  it('exists and renders its plans from lib/tiers.ts, not copied data', () => {
    expect(exists('app/pricing/page.tsx')).toBe(true);
    const page = read('app/pricing/page.tsx');
    expect(page).toContain("from '@/lib/tiers'");
    expect(page).toContain('TIERS.map');
    expect(page).toContain('tier.priceLabel');
    expect(page).toContain('tier.features');
    // Every tier in the source of truth appears on the page
    // through the shared render loop (name + availability label).
    for (const tier of TIERS) {
      expect(page).toContain('tier.name');
      expect(page).toContain('availabilityLabel(tier)');
    }
    expect(TIERS.map((t) => t.id)).toEqual(['free', 'premium', 'family', 'team']);
    expect(getTier('premium')?.priceLabel).toBe('$9.99');
    expect(getTier('family')?.priceLabel).toBe('To be announced');
    expect(getTier('team')?.priceStatus).toBe('custom');
  });

  it('has metadata with a canonical /pricing URL', () => {
    const page = read('app/pricing/page.tsx');
    expect(page).toContain("title: 'Pricing — SmartBuy AI'");
    expect(page).toContain('canonical: `${appConfig.url}/pricing`');
  });

  it('never presents a free trial as live — no trial terms exist', () => {
    const page = read('app/pricing/page.tsx');
    // The stored Premium CTA in lib/tiers.ts promises a trial
    // that does not exist, so the page must not render it.
    expect(page).not.toContain('Start Free Trial');
    expect(page).toContain("Payments aren&apos;t live yet");
    expect(page).toContain('no free trial is offered');
    // The replacement CTA promises only a free account.
    expect(page).toContain('Create a free account');
  });

  it('states the price-lock dormancy instead of presenting it as live', () => {
    const page = read('app/pricing/page.tsx');
    expect(page).toContain('dormant until Stripe is configured');
    expect(page).toContain('no lock is in force today');
    expect(page).toContain('getPriceLockConfig');
  });
});

describe('Section 12 — api-docs daily quotas', () => {
  it('enforces the four real daily quotas from lib/api-quota.ts', () => {
    expect(ANONYMOUS_DAILY_QUOTA).toBe(100);
    expect(API_QUOTAS.free).toBe(1_000);
    expect(API_QUOTAS.premium).toBe(10_000);
    expect(API_QUOTAS.family).toBe(10_000);
    expect(API_QUOTAS.team).toBe(100_000);
  });

  it('renders the daily quota table from those constants, not copied numbers', () => {
    const docs = read('app/api-docs/page.tsx');
    expect(docs).toContain("from '@/lib/api-quota'");
    expect(docs).toContain('ANONYMOUS_DAILY_QUOTA');
    expect(docs).toContain('API_QUOTAS');
    expect(docs).toContain('Daily quotas');
    expect(docs).toContain('API_QUOTAS.free');
    expect(docs).toContain('API_QUOTAS.premium');
    expect(docs).toContain('API_QUOTAS.family');
    expect(docs).toContain('API_QUOTAS.team');
    expect(docs).toContain('UTC midnight');
  });

  it('no longer contradicts the tiered quota system', () => {
    const docs = read('app/api-docs/page.tsx');
    expect(docs).not.toContain('Paid tiers and write access are not offered');
    // The corrected copy: paid tiers exist (as quota tiers), the
    // API stays read-only, and payments are not live yet.
    expect(docs).toContain('Paid tiers exist');
    expect(docs).toContain('write access is not offered');
    expect(docs).toContain("payments aren&apos;t live yet");
    expect(docs).toContain('href="/pricing"');
  });
});

describe('Section 12 — footer', () => {
  it('links to the affiliate disclosure', () => {
    const footer = read('components/layout/site-footer.tsx');
    expect(footer).toContain('Affiliate Disclosure');
    // The disclosure lives in the Methodology page (no standalone
    // disclosure page, and its heading carries no anchor id).
    expect(footer).toContain("href: '/methodology#affiliate-disclosure', label: 'Affiliate Disclosure'");
  });

  it('points Brands and Categories at the real index pages', () => {
    const footer = read('components/layout/site-footer.tsx');
    expect(footer).toContain("href: '/brands', label: 'Brands'");
    expect(footer).toContain("href: '/categories', label: 'Categories'");
    expect(footer).not.toContain("href: '/#browse', label: 'Brands'");
    expect(footer).not.toContain("href: '/#browse', label: 'Categories'");
  });

  it('mounts the newsletter capture component', () => {
    const footer = read('components/layout/site-footer.tsx');
    expect(footer).toContain(
      "import { NewsletterCapture } from '@/components/home/newsletter-capture'"
    );
    expect(footer).toContain('<NewsletterCapture source="footer" />');
  });
});

describe('Section 12 — dashboard upgrade CTA', () => {
  it('links to /pricing with honest not-live-yet copy, not a purchase button', () => {
    const dashboard = read('app/dashboard/page.tsx');
    expect(dashboard).toContain('Premium is coming');
    expect(dashboard).toContain("Payments aren&apos;t live yet");
    expect(dashboard).toContain('no free trial is offered');
    expect(dashboard).toContain('href="/pricing"');
    expect(dashboard).toContain('See Premium plans');
    expect(dashboard).not.toContain('Buy Premium');
    expect(dashboard).not.toContain('Subscribe now');
  });
});

describe('Section 12 — homepage mounts and pricing honesty note', () => {
  it('mounts the newsletter capture and push opt-in prompt components', () => {
    const home = read('app/page.tsx');
    expect(home).toContain(
      "import { NewsletterCapture } from '@/components/home/newsletter-capture'"
    );
    expect(home).toContain(
      "import { PushOptInPrompt } from '@/components/home/push-opt-in-prompt'"
    );
    expect(home).toContain('<NewsletterCapture source="homepage" />');
    expect(home).toContain('<PushOptInPrompt />');
  });

  it('states the payments / trial / price-lock honesty note under the pricing section', () => {
    const home = read('app/page.tsx');
    expect(home).toContain("Payments aren&apos;t live yet");
    expect(home).toContain('no free trial starts');
    expect(home).toContain('Price-lock is dormant until Stripe is configured');
    expect(home).toContain('href="/pricing"');
  });
});

describe('Section 12 — pricing route is real, not a redirect', () => {
  it('next.config.js no longer redirects /pricing to /#pricing', () => {
    const config = read('next.config.js');
    expect(config).not.toContain("source: '/pricing'");
    expect(config).not.toContain("destination: '/#pricing'");
  });

  it('the Premium tier promises no trial (lib/tiers.ts is the shared source)', () => {
    const tiers = read('lib/tiers.ts');
    expect(tiers).not.toContain('Start Free Trial');
    expect(getTier('premium')?.cta).toBe('See Premium plans');
    expect(getTier('premium')?.href).toBe('/pricing');
  });
});
