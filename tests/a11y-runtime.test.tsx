/**
 * Runtime accessibility suite (Section 15, C7).
 *
 * The only a11y enforcement before this file was static
 * source-scanning (tests/a11y-static.test.ts — reads the source,
 * asserts on it). This suite renders the real components in jsdom
 * and runs axe-core over the live DOM, so it catches what static
 * scanning cannot: missing accessible names at render time, invalid
 * ARIA, duplicate ids, bad heading order, form controls without
 * labels, and landmarks.
 *
 * What is rendered (representative set — the full Next.js pages
 * are async server components that fetch Supabase via next/headers
 * and cannot render in jsdom, so each page is represented by the
 * client components that compose it, plus the one tool page that
 * is a plain sync server component):
 *   - layout chrome: SiteHeader + SiteFooter (every page)
 *   - homepage: HeroCopy, LocalStoresSection
 *   - product page: ProductCard (with/without image, deal score,
 *     match score) — the card the listings and similar-products
 *     sections render
 *   - tools hub: ToolsHubContent (real group shape, real hrefs)
 *   - dashboard: GettingStartedChecklist, SavingsWidget
 *     (populated + empty state)
 *   - tool page: CurrencyConverterPage (full page incl. header,
 *     footer, form, ShareButtons) with a real query (?amount=100
 *     USD->PKR)
 *   - full-page assembly (Section 18, item 61): homepage chrome +
 *     hero + local stores + a product card + footer in one tree,
 *     the closest jsdom gets to a full page render
 *   - auth flow (Section 18, item 61): the sign-in page, incl. the
 *     session-expired banner state (via the mocked search params)
 *   - dashboard sub-page (Section 18, item 61): the dashboard
 *     sidebar (all 17 nav links + sign-out) with the checklist and
 *     savings widget, as a dashboard sub-page assembly
 *
 * Next.js primitives are mocked to plain DOM: next/link -> <a>,
 * next/navigation hooks -> static stubs, useAuth -> signed-out
 * guest. RegionProvider gets server-resolved initials (US/en) so
 * its client IP-detection effect never fires (no network).
 *
 * KNOWN LIMIT — colour contrast: jsdom has no layout engine, so
 * axe-core cannot compute contrast and reports `color-contrast`
 * as incomplete rather than pass/fail. The rule is disabled here
 * with a comment; contrast still needs a real browser (Playwright
 * / LHCI — not in this repo yet, out of scope for C7).
 *
 * Run with: npm run test:a11y (vitest.a11y.config.ts — jsdom,
 * this file only). The main `npm test` suite is untouched.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import axe from 'axe-core';
import React, { type ReactElement } from 'react';

import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { HeroCopy } from '@/components/home/hero-copy';
import { LocalStoresSection } from '@/components/home/local-stores-section';
import { ProductCard, type ProductCardData } from '@/components/products/product-card';
import { ToolsHubContent, type ToolsHubGroup } from '@/components/tools/tools-hub-content';
import { GettingStartedChecklist } from '@/components/dashboard/getting-started-checklist';
import { SavingsWidget } from '@/components/dashboard/savings-widget';
import { RegionProvider } from '@/components/region/region-provider';
import CurrencyConverterPage from '@/app/tools/currency-converter/page';
import SignInPage from '@/app/sign-in/page';
import { DashboardSidebar } from '@/components/layout/dashboard-sidebar';

afterEach(cleanup);

// --- Next.js / auth mocks (plain-DOM stand-ins) -------------------------

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  } & Record<string, unknown>) =>
    React.createElement('a', { href, ...props }, children),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

// CurrencyConverterPage reads the sb-language cookie via
// next/headers (toolLanguage). jsdom has no request store, so
// cookies() would throw its requestAsyncStorage invariant —
// stub it to "no cookie", which falls back to 'en', exactly as
// the page does for a first visit with no cookie set.
vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => undefined }),
  headers: () => new Headers(),
}));

vi.mock('@/features/auth', () => ({
  useAuth: () => ({
    user: null,
    profile: null,
    role: 'user',
    isLoading: false,
    isAuthenticated: false,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signInWithGoogle: vi.fn(),
    signOut: vi.fn(),
    resetPassword: vi.fn(),
    updatePassword: vi.fn(),
    resendVerification: vi.fn(),
    refreshProfile: vi.fn(),
  }),
}));

// jsdom has no window.matchMedia; next-themes (ThemeToggle in the
// header) calls it. Stub it before any render.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList) as typeof window.matchMedia;
}

// --- axe helper ----------------------------------------------------------

/**
 * Run axe-core over a rendered container and fail with a readable
 * list of violations. `color-contrast` is disabled: jsdom has no
 * layout engine, so axe reports it as incomplete, never pass/fail
 * (see the file header — contrast needs a real browser).
 */
async function expectNoAxeViolations(container: HTMLElement, label: string) {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } },
  });
  const detail = results.violations
    .map(
      (v) =>
        `\n  [${v.id}] ${v.help} (${v.impact ?? 'unknown'}): ` +
        v.nodes.map((n) => n.html).join(' | ')
    )
    .join('');
  expect(results.violations, `${label} axe violations:${detail}`).toEqual([]);
}

function withRegion(children: ReactElement) {
  return (
    <RegionProvider initialCountryCode="US" initialLanguage="en">
      {children}
    </RegionProvider>
  );
}

const MACBOOK: ProductCardData = {
  id: 'macbook-air-m4',
  name: 'Apple MacBook Air M4',
  slug: 'apple-macbook-air-m4',
  brand: 'Apple',
  category: 'Laptops',
  imageUrl: 'https://example.com/macbook-air-m4.jpg',
  description: 'Apple MacBook Air with M4 chip, 16GB RAM, 256GB SSD.',
  price: 999,
  merchantCount: 2,
  dealScore: 100,
};

const GALAXY_NO_IMAGE: ProductCardData = {
  id: 'galaxy-s25',
  name: 'Samsung Galaxy S25',
  slug: 'samsung-galaxy-s25',
  brand: 'Samsung',
  category: 'Phones',
  imageUrl: null,
  description: 'Samsung Galaxy S25, 256GB.',
  price: 799,
  merchantCount: 1,
  dealScore: null,
  matchScore: 87,
};

const HUB_GROUPS: ToolsHubGroup[] = [
  {
    headingKey: 'toolsHubGroupEveryday',
    tools: [
      {
        name: 'Help Me Choose — guided shopping quiz',
        href: '/tools/help-me-choose',
        description:
          'Not sure what to buy? Answer a few quick questions about what you need and what matters most.',
        isNew: true,
      },
      {
        name: 'Budget Finder',
        href: '/tools/budget-finder',
        description:
          'Tell it what you want and the most you want to spend — it shows the best matches in the catalog under your budget.',
      },
    ],
  },
  {
    headingKey: 'toolsHubGroupMoney',
    tools: [
      {
        name: 'Currency Converter',
        href: '/tools/currency-converter',
        description:
          'Convert any amount between 51 currencies — for example $999 to PKR. Approximate static rates.',
      },
    ],
  },
];

describe('runtime accessibility (axe-core)', () => {
  it('layout chrome: SiteHeader + SiteFooter have no axe violations', async () => {
    const { container } = render(
      withRegion(
        <>
          <SiteHeader />
          <SiteFooter />
        </>
      )
    );
    await expectNoAxeViolations(container, 'SiteHeader + SiteFooter');
  });

  it('homepage: hero copy + local stores section have no axe violations', async () => {
    const { container } = render(
      withRegion(
        <>
          <HeroCopy />
          <LocalStoresSection />
        </>
      )
    );
    await expectNoAxeViolations(container, 'homepage hero + local stores');
  });

  it('product page: ProductCard (image + deal score, and no-image + match score) has no axe violations', async () => {
    const { container } = render(
      <RegionProvider initialCountryCode="US" initialLanguage="en">
        <ProductCard product={MACBOOK} />
        <ProductCard product={GALAXY_NO_IMAGE} showReason />
      </RegionProvider>
    );
    await expectNoAxeViolations(container, 'ProductCard');
  });

  it('tools hub: ToolsHubContent has no axe violations', async () => {
    const { container } = render(withRegion(<ToolsHubContent groups={HUB_GROUPS} />));
    await expectNoAxeViolations(container, 'ToolsHubContent');
  });

  it('dashboard: checklist + savings widget (populated) have no axe violations', async () => {
    const { container } = render(
      withRegion(
        <>
          <GettingStartedChecklist hasSavedProduct hasAlert={false} />
          <SavingsWidget totalSaved={42.5} eventCount={3} streakWeeks={2} badge="bronze" />
        </>
      )
    );
    await expectNoAxeViolations(container, 'dashboard populated');
  });

  it('dashboard: savings widget empty state has no axe violations', async () => {
    const { container } = render(
      withRegion(
        <SavingsWidget totalSaved={0} eventCount={0} streakWeeks={0} badge="none" />
      )
    );
    await expectNoAxeViolations(container, 'dashboard savings empty state');
  });

  it('tool page: CurrencyConverterPage (?amount=100 USD->PKR) has no axe violations', async () => {
    const { container } = render(
      withRegion(
        <CurrencyConverterPage searchParams={{ amount: '100', from: 'USD', to: 'PKR' }} />
      )
    );
    await expectNoAxeViolations(container, 'CurrencyConverterPage');
  });

  it('full page: homepage assembly (header + hero + stores + product card + footer) has no axe violations', async () => {
    const { container } = render(
      withRegion(
        <>
          <SiteHeader />
          <main>
            <HeroCopy />
            <LocalStoresSection />
            <ProductCard product={MACBOOK} />
          </main>
          <SiteFooter />
        </>
      )
    );
    await expectNoAxeViolations(container, 'homepage full-page assembly');
  });

  it('auth flow: sign-in page has no axe violations', async () => {
    const { container } = render(withRegion(<SignInPage />));
    await expectNoAxeViolations(container, 'SignInPage');
  });

  it('dashboard sub-page: sidebar + checklist + savings widget have no axe violations', async () => {
    const { container } = render(
      withRegion(
        <>
          <DashboardSidebar />
          <GettingStartedChecklist hasSavedProduct hasAlert={false} />
          <SavingsWidget totalSaved={42.5} eventCount={3} streakWeeks={2} badge="bronze" />
        </>
      )
    );
    await expectNoAxeViolations(container, 'dashboard sub-page assembly');
  });
});
