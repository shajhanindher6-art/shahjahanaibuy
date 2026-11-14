/**
 * GuidedJourney — the flexible guided-journey step list
 * (Master Tool Integration, Stage 5, S5-1 + S5-2).
 *
 * The brief's Phase 4 path as plain links, in order:
 *   search → discovery → persona-fit → own-it-check → compare →
 *   price-match → price history → deal-stacker → energy-cost →
 *   repairability → compatibility-checker → upgrade-advisor → decision.
 *
 * FLEXIBLE, not a forced funnel: every step is a link, the user can
 * enter or exit at any step, and every tool still works standalone.
 * The component never blocks navigation and holds no state.
 *
 * Product carrying (Stage-1 link builders from
 * services/tool-integration.ts wherever one exists):
 * - ?product= : own-it-check, deal-stacker, energy-cost, repairability
 * - ?device=  : compatibility-checker (T10 dialect)
 * - ?current= : upgrade-advisor (T1 dialect)
 * - /compare  : ?products=<uuid> when the product id is known,
 *   else the bare picker (a slug alone cannot build a /compare URL —
 *   /compare resolves UUIDs; see compareLinkForProduct)
 * - no product param on the destination, so bare by design:
 *   persona-fit (persona/budget only), price-match (status filter
 *   only), price-history (sort only), help-me-choose (answers only)
 * - /search carries the product as ?q=<slug> (its own dialect);
 *   discovery is /tools/help-me-choose, the guided-quiz tool.
 * - decision has NO dedicated route: with a product it is the
 *   product page itself (/products/<slug>), where the buy-vs-wait
 *   verdict lives (components/products/buy-vs-wait.tsx); without
 *   one it is /compare, whose decision-matrix is the other
 *   decision surface. No new route was invented for this step.
 * With no product every step links to its bare route — never an
 * empty ?product= / ?device= / ?current= / ?q=.
 *
 * Return to previous results (S5-2, Stage-1 saved-URL pattern —
 * no new storage): pass `savedResult` ({ tool, params }) and the
 * component renders a "Return to your last result" link built by
 * buildSavedCalculationUrl (services/saved-calculations.ts). The
 * link renders ONLY when the tool is a saved-calculation tool AND
 * the built URL actually replays params (contains a query string);
 * otherwise it is omitted silently — never a dead link. Which
 * tools support it (Stage 3, S3-3 — SAVED_CALCULATION_TOOLS in
 * lib/saved-calculations.ts): the 8 new tools with replayable
 * results — upgrade-advisor, persona-fit, own-it-check,
 * energy-cost, negotiation-coach, deal-stacker,
 * refurbished-checklist, compatibility-checker — plus the 12 older
 * calculator tools. Which DON'T, by design: price-match (a
 * filter-only directory — ?status= is a filter, not a calculable
 * result) and repairability (a listing + explainer with no params
 * at all). The hub and product-page mounts pass no saved result,
 * so the link simply doesn't render there.
 *
 * Mounted in exactly TWO places: the tools hub
 * (app/tools/page.tsx) and the product detail page
 * (app/products/[slug]/page.tsx, alongside the Stage-3
 * "Tools for this product" block). NOT on the tool pages —
 * the Stage-3 RelatedTools blocks already link onward from
 * each tool. `currentStep` marks the step when rendered on a
 * tool page (aria-current="step" + "You are here"); it is
 * optional and unused by the two mounts.
 *
 * Server component: no client state, no fetch, pure links.
 */

import Link from 'next/link';
import {
  compareLink,
  compatibilityLink,
  dealStackerLink,
  energyCostLink,
  ownItLink,
  personaFitLink,
  priceMatchLink,
  repairabilityLink,
  upgradeAdvisorLink,
} from '@/services/tool-integration';
import { buildSavedCalculationUrl } from '@/services/saved-calculations';
import {
  isSavedCalculationTool,
  type CalculationParams,
} from '@/lib/saved-calculations';

/** Stable id for one journey step (also the `currentStep` value). */
export type GuidedJourneyStepId =
  | 'search'
  | 'discovery'
  | 'persona-fit'
  | 'own-it-check'
  | 'compare'
  | 'price-match'
  | 'price-history'
  | 'deal-stacker'
  | 'energy-cost'
  | 'repairability'
  | 'compatibility-checker'
  | 'upgrade-advisor'
  | 'decision';

/** One journey step: id + label + destination href. */
export interface GuidedJourneyStep {
  id: GuidedJourneyStepId;
  label: string;
  blurb: string;
  href: string;
}

function slugOrNull(slug: string | null | undefined): string | null {
  if (slug === null || slug === undefined) return null;
  const trimmed = slug.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The 13 journey steps for a product (or none). Pure data — no JSX —
 * so tests can assert the order, the dialects and the bare-route
 * behaviour without rendering. Every destination route exists in
 * the app router; no step ever links to a route that does not exist.
 */
export function guidedJourneySteps(
  productSlug: string | null | undefined,
  productId?: string | null
): GuidedJourneyStep[] {
  const slug = slugOrNull(productSlug);
  const id = productId !== null && productId !== undefined && productId.trim() !== ''
    ? productId.trim()
    : null;
  return [
    {
      id: 'search',
      label: 'Search for a product',
      blurb: 'Find the product in the catalog first.',
      href: slug ? `/search?q=${encodeURIComponent(slug)}` : '/search',
    },
    {
      id: 'discovery',
      label: 'Discover what fits',
      blurb: 'A short guided quiz narrows the catalog to a shortlist.',
      href: '/tools/help-me-choose',
    },
    {
      id: 'persona-fit',
      label: 'Find your persona fit',
      blurb: 'Ranked matches for your persona and budget.',
      href: personaFitLink(),
    },
    {
      id: 'own-it-check',
      label: 'Check you don’t already own it',
      blurb: 'Your saved lists, before you buy a duplicate.',
      href: ownItLink(slug),
    },
    {
      id: 'compare',
      label: 'Compare products',
      blurb: 'Side by side, with the decision matrix.',
      href: id ? compareLink([id]) : compareLink([]),
    },
    {
      id: 'price-match',
      label: 'Check the price-match policy',
      blurb: 'Which stores price-match, and how to claim it.',
      href: priceMatchLink(),
    },
    {
      id: 'price-history',
      label: 'See recorded price history',
      blurb: 'The recorded 30-day history, never smoothed.',
      href: '/tools/price-history',
    },
    {
      id: 'deal-stacker',
      label: 'Stack the deal',
      blurb: 'Best valid coupon + cashback + recorded price drop.',
      href: dealStackerLink(slug),
    },
    {
      id: 'energy-cost',
      label: 'Calculate the energy cost',
      blurb: 'What the device costs to run per year.',
      href: energyCostLink(slug),
    },
    {
      id: 'repairability',
      label: 'Check repairability',
      blurb: 'Score, spare-parts years, and how it is computed.',
      href: repairabilityLink(slug),
    },
    {
      id: 'compatibility-checker',
      label: 'Check compatibility',
      blurb: 'Will this accessory work with your device?',
      href: compatibilityLink(slug),
    },
    {
      id: 'upgrade-advisor',
      label: 'Is this an upgrade?',
      blurb: 'Cost-per-year vs a successor, plus a resale projection.',
      href: upgradeAdvisorLink(slug),
    },
    {
      id: 'decision',
      label: 'Decide: buy or wait',
      blurb: 'The buy-vs-wait verdict on the product page.',
      href: slug ? `/products/${encodeURIComponent(slug)}` : '/compare',
    },
  ];
}

/** A saved result to offer a return link to (S5-2). */
export interface GuidedJourneySavedResult {
  /** Tool slug, e.g. 'energy-cost'. */
  tool: string;
  /** The exact inputs the result URL replays. */
  params: CalculationParams;
}

/**
 * The return-to-results href for a saved result, or null when no
 * link may be shown: unknown / non-saved tool (price-match,
 * repairability), or params that replay to nothing. The bare-tool
 * fallback of buildSavedCalculationUrl is never returned — a
 * "return to your last result" link must replay a result, not
 * just open the tool.
 */
export function guidedJourneyReturnUrl(
  savedResult: GuidedJourneySavedResult | null | undefined
): string | null {
  if (!savedResult) return null;
  if (!isSavedCalculationTool(savedResult.tool)) return null;
  const url = buildSavedCalculationUrl(savedResult.tool, savedResult.params);
  if (!url.includes('?')) return null;
  return url;
}

export function GuidedJourney({
  productSlug,
  productId,
  currentStep,
  savedResult,
}: {
  /** Canonical product slug; null/empty → every step is bare. */
  productSlug?: string | null;
  /** Product UUID for the /compare step; bare /compare without it. */
  productId?: string | null;
  /** Id of the step the user is on, when rendered on a tool page. */
  currentStep?: GuidedJourneyStepId | string | null;
  /** A saved result to offer a return link to (S5-2); omit to hide. */
  savedResult?: GuidedJourneySavedResult | null;
}): JSX.Element {
  const steps = guidedJourneySteps(productSlug, productId);
  const hasProduct = slugOrNull(productSlug) !== null;
  const returnUrl = guidedJourneyReturnUrl(savedResult);
  return (
    <section
      aria-labelledby="guided-journey"
      className="mt-10 rounded-lg border p-6"
    >
      <h2 id="guided-journey" className="text-xl font-semibold">
        Guided journey
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {hasProduct
          ? 'Follow the steps in order — or jump in at any step. The product travels with each link, so you never re-pick it.'
          : 'Follow the steps in order — or jump in at any step. Every tool still works on its own.'}
      </p>
      <ol className="mt-4 space-y-2">
        {steps.map((step, index) => {
          const isCurrent = currentStep === step.id;
          return (
            <li key={step.id} className="flex items-baseline gap-2">
              <span
                aria-hidden="true"
                className="text-sm font-semibold text-muted-foreground"
              >
                {index + 1}.
              </span>
              <span>
                <Link
                  href={step.href}
                  aria-current={isCurrent ? 'step' : undefined}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {step.label} →
                </Link>
                {isCurrent && (
                  <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium">
                    You are here
                  </span>
                )}
                <span className="text-sm text-muted-foreground">
                  {' '}
                  — {step.blurb}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      {returnUrl !== null && (
        <p className="mt-4">
          <Link
            href={returnUrl}
            className="font-medium underline-offset-4 hover:underline"
          >
            Return to your last result →
          </Link>
        </p>
      )}
    </section>
  );
}
