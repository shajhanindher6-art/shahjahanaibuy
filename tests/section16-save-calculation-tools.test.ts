/**
 * Section 16, #36 — Save-calculation-to-account on the remaining
 * pure-local tools.
 *
 * The 12 pure-local calculator tools are the SAVED_CALCULATION_TOOLS
 * list in lib/saved-calculations.ts (0 fetch() calls each). 3 were
 * already wired in the Section 16 build (EMI, landed-cost,
 * currency-converter); this file covers the remaining 9.
 *
 * 6 of the 9 were DEFERRED while the per-page metadata worker
 * owned their files — that worker has finished, so they are
 * mounted now and asserted as wired below, like the other 3.
 * Only the 3 mounted here (gift-splitter, budget-finder,
 * forecast-explainer) were asserted as wired before this change.
 *
 * All assertions are source-level (same style as the #36 wiring
 * test in tests/section16-retention-monetization.test.ts): the
 * button is a client component mounted in server pages, so what
 * can be asserted without a browser is the mount + the exact
 * params it is passed.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readRepo(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

/** The 12 pure-local tools, from lib/saved-calculations.ts. */
const PURE_LOCAL_TOOLS = [
  'emi-calculator',
  'landed-cost',
  'gift-splitter',
  'currency-converter',
  'budget-finder',
  'forecast-explainer',
  'future-you-planner',
  'monthly-planner',
  'expense-tracker',
  'subscription-manager',
  'savings-dashboard',
  'list-optimizer',
] as const;

/** Mounted in the Section 16 build, before this file. */
const ALREADY_WIRED = ['emi-calculator', 'landed-cost', 'currency-converter'] as const;

/** Mounted by this change. */
const MOUNTED_HERE = ['gift-splitter', 'budget-finder', 'forecast-explainer'] as const;

/**
 * Mounted now that the per-page metadata worker has finished
 * (it owned these files while the first 3 were wired here).
 */
const DEFERRED_FOR_METADATA_WORKER = [
  'expense-tracker',
  'future-you-planner',
  'list-optimizer',
  'monthly-planner',
  'savings-dashboard',
  'subscription-manager',
] as const;

function toolPage(tool: string): string {
  return readRepo(`app/tools/${tool}/page.tsx`);
}

describe('Section 16, #36 — the 12 pure-local tools', () => {
  it('is exactly the 12 tools in SAVED_CALCULATION_TOOLS (3 done + 3 here + 6 mounted)', () => {
    const lib = readRepo('lib/saved-calculations.ts');
    for (const tool of PURE_LOCAL_TOOLS) {
      expect(lib).toContain(`'${tool}'`);
    }
    expect([...ALREADY_WIRED, ...MOUNTED_HERE, ...DEFERRED_FOR_METADATA_WORKER].sort()).toEqual(
      [...PURE_LOCAL_TOOLS].sort()
    );
  });

  it('the 3 tools wired in the Section 16 build still mount the button', () => {
    for (const tool of ALREADY_WIRED) {
      const page = toolPage(tool);
      expect(page).toContain('SaveCalculationButton');
      expect(page).toContain(`tool="${tool}"`);
    }
  });

  it.each(MOUNTED_HERE)('%s mounts SaveCalculationButton with its own tool slug', (tool) => {
    const page = toolPage(tool);
    expect(page).toContain(
      "import { SaveCalculationButton } from '@/components/tools/save-calculation-button'"
    );
    expect(page).toContain('<SaveCalculationButton');
    expect(page).toContain(`tool="${tool}"`);
  });

  it('gift-splitter passes its actual inputs (total + occasion)', () => {
    const page = toolPage('gift-splitter');
    expect(page).toContain('total: split.totalUsd');
    expect(page).toContain('occasion');
    // Recipients are arrays — the share-URL builder takes scalar
    // params only — so the label carries the recipient list and is
    // capped at the API's 100-char label limit.
    expect(page).toContain('Gift split $');
    expect(page).toContain('.slice(0, 100)');
  });

  it('budget-finder passes its actual inputs (category + budget as written)', () => {
    const page = toolPage('budget-finder');
    expect(page).toContain('category');
    expect(page).toContain('budget:');
    // The budget as written ("20K PKR"), not the converted USD
    // figure — re-opening the link re-parses it as the form did.
    expect(page).toContain('budgetCurrency');
  });

  it('forecast-explainer mounts one button per product with that product as the param', () => {
    const page = toolPage('forecast-explainer');
    expect(page).toContain('params={{ product: product.slug }}');
    // Only when a forecast exists — no button on the
    // not-enough-history state, where there is nothing to save.
    expect(page).toContain("forecast.status === 'ok'");
    // The label quotes the 30-day range (middle horizon).
    expect(page).toContain('horizonDays === 30');
  });

  it('forecast-explainer replays a saved calculation via ?product=<slug>', () => {
    const page = toolPage('forecast-explainer');
    expect(page).toContain('searchParams');
    expect(page).toContain('product');
    expect(page).toContain('visibleItems');
    // An unknown slug is an honest empty state, never a silent
    // full list.
    expect(page).toContain('unknownProduct');
    expect(page).toContain('No forecast found for');
  });

  it('guests see a sign-in prompt, not a save button that cannot work', () => {
    const button = readRepo('components/tools/save-calculation-button.tsx');
    expect(button).toContain('Sign in');
    expect(button).toContain('/sign-in');
    expect(button).toContain('to save this calculation to your account.');
  });

  describe.each(DEFERRED_FOR_METADATA_WORKER)(
    '%s — SaveCalculationButton mounted',
    (tool) => {
      it(`mounts SaveCalculationButton — un-skipped once the metadata worker finished ${tool}`, () => {
        const page = toolPage(tool);
        expect(page).toContain('SaveCalculationButton');
        expect(page).toContain(`tool="${tool}"`);
      });
    }
  );
});
