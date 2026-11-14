// @vitest-environment jsdom
/**
 * Guided journey — Master Tool Integration, Stage 5 (S5-1 + S5-2).
 *
 * Pins the 13-step journey: order, destination routes, product
 * carrying in each destination's own dialect, bare-route behaviour
 * with no product, current-step marking, and the return-to-results
 * link (present only when a saved result exists on a tool that
 * supports one). No dead routes: every step href's pathname is
 * asserted against the hardcoded list of the 13 expected routes.
 *
 * Render tests use React.createElement (this is a .ts file — no
 * JSX) with next/link mocked to a plain <a>, the same pattern as
 * tests/w2-label-honesty-render.test.tsx.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import {
  GuidedJourney,
  guidedJourneyReturnUrl,
  guidedJourneySteps,
  type GuidedJourneyStepId,
} from '@/components/tools/guided-journey';
import { buildSavedCalculationUrl } from '@/services/saved-calculations';

afterEach(cleanup);

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

function readSource(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

const SLUG = 'macbook-air-m2';
const PRODUCT_ID = '11111111-2222-3333-4444-555555555555';

/** The 13 expected journey step ids, in order. */
const EXPECTED_IDS: GuidedJourneyStepId[] = [
  'search',
  'discovery',
  'persona-fit',
  'own-it-check',
  'compare',
  'price-match',
  'price-history',
  'deal-stacker',
  'energy-cost',
  'repairability',
  'compatibility-checker',
  'upgrade-advisor',
  'decision',
];

/**
 * The 13 expected destination routes, in step order. Hardcoded —
 * deliberately NOT imported from the app — so a step linking to a
 * route that does not exist fails here. /products/<slug> stands
 * for the dynamic product route.
 */
const EXPECTED_ROUTES = [
  '/search',
  '/tools/help-me-choose',
  '/tools/persona-fit',
  '/tools/own-it-check',
  '/compare',
  '/tools/price-match',
  '/tools/price-history',
  '/tools/deal-stacker',
  '/tools/energy-cost',
  '/tools/repairability',
  '/tools/compatibility-checker',
  '/tools/upgrade-advisor',
  '/products/macbook-air-m2',
];

function pathnameOf(href: string): string {
  return href.split('?')[0];
}

describe('guidedJourneySteps — 13 steps in order', () => {
  it('renders all 13 steps in the brief’s Phase 4 order', () => {
    const steps = guidedJourneySteps(SLUG, PRODUCT_ID);
    expect(steps.map((s) => s.id)).toEqual(EXPECTED_IDS);
    expect(steps).toHaveLength(13);
  });

  it('every step href’s route exists in the app router', () => {
    const steps = guidedJourneySteps(SLUG, PRODUCT_ID);
    const routes = steps.map((s) => pathnameOf(s.href));
    expect(routes).toEqual(EXPECTED_ROUTES);
    expect(new Set(routes).size).toBe(13);
  });

  it('carries the product in each destination’s own dialect', () => {
    const byId = new Map(
      guidedJourneySteps(SLUG, PRODUCT_ID).map((s) => [s.id, s.href])
    );
    expect(byId.get('search')).toBe(`/search?q=${SLUG}`);
    expect(byId.get('own-it-check')).toBe(
      `/tools/own-it-check?product=${SLUG}`
    );
    expect(byId.get('compare')).toBe(`/compare?products=${PRODUCT_ID}`);
    expect(byId.get('deal-stacker')).toBe(
      `/tools/deal-stacker?product=${SLUG}`
    );
    expect(byId.get('energy-cost')).toBe(
      `/tools/energy-cost?product=${SLUG}`
    );
    expect(byId.get('repairability')).toBe(
      `/tools/repairability?product=${SLUG}`
    );
    expect(byId.get('compatibility-checker')).toBe(
      `/tools/compatibility-checker?device=${SLUG}`
    );
    expect(byId.get('upgrade-advisor')).toBe(
      `/tools/upgrade-advisor?current=${SLUG}`
    );
    expect(byId.get('decision')).toBe(`/products/${SLUG}`);
  });

  it('tools with no product param link bare (persona-fit, price-match, price-history, discovery)', () => {
    const byId = new Map(
      guidedJourneySteps(SLUG, PRODUCT_ID).map((s) => [s.id, s.href])
    );
    expect(byId.get('discovery')).toBe('/tools/help-me-choose');
    expect(byId.get('persona-fit')).toBe('/tools/persona-fit');
    expect(byId.get('price-match')).toBe('/tools/price-match');
    expect(byId.get('price-history')).toBe('/tools/price-history');
  });

  it('compare is bare when only a slug is known (no product id)', () => {
    const byId = new Map(
      guidedJourneySteps(SLUG).map((s) => [s.id, s.href])
    );
    expect(byId.get('compare')).toBe('/compare');
    // …and the other product-carrying steps still carry the slug.
    expect(byId.get('own-it-check')).toBe(
      `/tools/own-it-check?product=${SLUG}`
    );
    expect(byId.get('decision')).toBe(`/products/${SLUG}`);
  });
});

describe('guidedJourneySteps — no product', () => {
  it('all 13 steps still render, as bare routes', () => {
    const steps = guidedJourneySteps(null);
    expect(steps.map((s) => s.id)).toEqual(EXPECTED_IDS);
    expect(steps.map((s) => pathnameOf(s.href))).toEqual([
      '/search',
      '/tools/help-me-choose',
      '/tools/persona-fit',
      '/tools/own-it-check',
      '/compare',
      '/tools/price-match',
      '/tools/price-history',
      '/tools/deal-stacker',
      '/tools/energy-cost',
      '/tools/repairability',
      '/tools/compatibility-checker',
      '/tools/upgrade-advisor',
      '/compare',
    ]);
  });

  it('never emits an empty product param', () => {
    for (const steps of [
      guidedJourneySteps(null),
      guidedJourneySteps(undefined),
      guidedJourneySteps(''),
      guidedJourneySteps('   '),
    ]) {
      for (const step of steps) {
        expect(step.href).not.toContain('product=');
        expect(step.href).not.toContain('device=');
        expect(step.href).not.toContain('current=');
        expect(step.href).not.toContain('q=');
        expect(step.href).not.toContain('products=');
      }
    }
  });

  it('decision without a product is /compare (the decision surface)', () => {
    const byId = new Map(
      guidedJourneySteps(null).map((s) => [s.id, s.href])
    );
    expect(byId.get('decision')).toBe('/compare');
  });
});

describe('GuidedJourney — render', () => {
  function renderJourney(
    props: React.ComponentProps<typeof GuidedJourney>
  ) {
    return render(React.createElement(GuidedJourney, props));
  }

  it('renders the 13 step links in order with the product carried', () => {
    const { container } = renderJourney({
      productSlug: SLUG,
      productId: PRODUCT_ID,
    });
    const links = Array.from(container.querySelectorAll('ol a'));
    expect(links).toHaveLength(13);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(
      guidedJourneySteps(SLUG, PRODUCT_ID).map((s) => s.href)
    );
    expect(container.querySelector('h2#guided-journey')?.textContent).toBe(
      'Guided journey'
    );
  });

  it('renders bare routes with no product', () => {
    const { container } = renderJourney({});
    const links = Array.from(container.querySelectorAll('ol a'));
    expect(links).toHaveLength(13);
    for (const a of links) {
      expect(a.getAttribute('href') ?? '').not.toContain('product=');
    }
  });

  it('marks the current step with aria-current="step" and "You are here"', () => {
    const { container } = renderJourney({
      productSlug: SLUG,
      currentStep: 'persona-fit',
    });
    const marked = container.querySelectorAll('a[aria-current="step"]');
    expect(marked).toHaveLength(1);
    expect(marked[0].getAttribute('href')).toBe('/tools/persona-fit');
    expect(container.textContent).toContain('You are here');
  });

  it('marks nothing when no currentStep is given', () => {
    const { container } = renderJourney({ productSlug: SLUG });
    expect(container.querySelectorAll('a[aria-current="step"]')).toHaveLength(
      0
    );
    expect(container.textContent).not.toContain('You are here');
  });

  it('an unknown currentStep marks nothing (never blocks navigation)', () => {
    const { container } = renderJourney({
      productSlug: SLUG,
      currentStep: 'not-a-step',
    });
    expect(container.querySelectorAll('a[aria-current="step"]')).toHaveLength(
      0
    );
  });
});

describe('guidedJourneyReturnUrl / return-to-results link (S5-2)', () => {
  const energyParams = {
    watts: 100,
    hours: 5,
    tariff: 0.2,
    product: SLUG,
  };

  it('builds the return URL for a saved result on a supported tool', () => {
    expect(
      guidedJourneyReturnUrl({ tool: 'energy-cost', params: energyParams })
    ).toBe(buildSavedCalculationUrl('energy-cost', energyParams));
  });

  it('renders the "Return to your last result" link when a saved result exists', () => {
    const { container } = render(
      React.createElement(GuidedJourney, {
        productSlug: SLUG,
        savedResult: { tool: 'energy-cost', params: energyParams },
      })
    );
    const link = Array.from(container.querySelectorAll('a')).find((a) =>
      (a.textContent ?? '').includes('Return to your last result')
    );
    expect(link).toBeDefined();
    expect(link?.getAttribute('href')).toBe(
      buildSavedCalculationUrl('energy-cost', energyParams)
    );
  });

  it('omits the return link when no saved result exists', () => {
    const { container } = render(
      React.createElement(GuidedJourney, { productSlug: SLUG })
    );
    expect(container.textContent).not.toContain('Return to your last result');
  });

  it('omits the return link for price-match (filter-only, no saved result)', () => {
    expect(
      guidedJourneyReturnUrl({ tool: 'price-match', params: { status: 'yes' } })
    ).toBeNull();
  });

  it('omits the return link for repairability (no params at all)', () => {
    expect(guidedJourneyReturnUrl({ tool: 'repairability', params: {} })).toBeNull();
  });

  it('omits the return link when the params replay to nothing', () => {
    expect(
      guidedJourneyReturnUrl({ tool: 'energy-cost', params: {} })
    ).toBeNull();
    const { container } = render(
      React.createElement(GuidedJourney, {
        productSlug: SLUG,
        savedResult: { tool: 'energy-cost', params: {} },
      })
    );
    expect(container.textContent).not.toContain('Return to your last result');
  });
});

describe('GuidedJourney — mounts (source-level)', () => {
  it('is mounted on the tools hub (compact section, hub list untouched)', () => {
    const hub = readSource('app/tools/page.tsx');
    expect(hub).toContain("import { GuidedJourney } from '@/components/tools/guided-journey'");
    expect(hub).toContain('<GuidedJourney />');
    expect(hub).toContain('ToolsHubContent');
    // isNew flags untouched: still exactly the 10 new tools.
    expect(hub.match(/isNew: true/g)?.length).toBe(10);
  });

  it('is mounted on the product page alongside the Stage-3 block', () => {
    const page = readSource('app/products/[slug]/page.tsx');
    expect(page).toContain("import { GuidedJourney } from '@/components/tools/guided-journey'");
    expect(page).toContain(
      '<GuidedJourney productSlug={seo.slug} productId={seo.id} />'
    );
    expect(page).toContain('<ProductTools');
  });

  it('is NOT mounted on any tool page (hub + product page only)', () => {
    const toolPages = [
      'upgrade-advisor',
      'persona-fit',
      'price-match',
      'own-it-check',
      'energy-cost',
      'negotiation-coach',
      'repairability',
      'deal-stacker',
      'refurbished-checklist',
      'compatibility-checker',
    ];
    for (const tool of toolPages) {
      expect(readSource(`app/tools/${tool}/page.tsx`)).not.toContain(
        'GuidedJourney'
      );
    }
  });
});
