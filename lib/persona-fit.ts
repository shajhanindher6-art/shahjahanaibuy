/**
 * AI Persona Fit Finder — pure helpers for /tools/persona-fit.
 *
 * The user picks one of six personas + a budget and gets the
 * catalog products that fit that persona, ranked. Scoring reuses
 * the engine in services/persona-matcher.ts (scorePersona /
 * matchVerdict) — this file adds NO new scoring of its own.
 *
 * ------------------------------------------------------------------
 * PERSONA RECONCILIATION (audit §2 T2 vs the engine) — read this
 * before changing the mapping below.
 *
 * The audit lists SIX personas (Student, Creator, Gamer, Traveler,
 * Home Office, Fitness). The engine (services/persona-matcher.ts)
 * defines FOUR: 'work' | 'gaming' | 'student' | 'content'. There
 * is no Traveler, Home Office or Fitness persona in the engine, and
 * inventing spec thresholds for them would be invented scoring, so
 * the six UI personas map onto the four engine personas as follows:
 *
 *   Student     → 'student'  (direct engine persona)
 *   Creator     → 'content'  (direct: the engine's "Content
 *                             Creation" persona — photo, video,
 *                             audio work)
 *   Gamer       → 'gaming'   (direct engine persona)
 *   Traveler    → 'work'     (no engine persona exists; Work is
 *                             the closest — everyday productivity
 *                             on the move. NOTHING travel-specific
 *                             is scored: no weight, battery-life or
 *                             portability data is recorded.)
 *   Home Office → 'work'     (no engine persona exists; Work is
 *                             the closest — everyday productivity
 *                             at a desk. No desk-setup data is
 *                             recorded or scored.)
 *   Fitness     → 'work'     (no engine persona exists; Work is
 *                             the closest GENERIC persona. This is
 *                             the weakest mapping and it is labelled
 *                             as such in the UI: no fitness, health
 *                             or activity data is recorded, and a
 *                             wearable does NOT earn a category fit
 *                             from Work's categories — it scores
 *                             "below" on category fit like any
 *                             other non-matching category.)
 *
 * Each UI persona carries its mappingNote, shown on the page next
 * to the results, so a mapped persona is never presented as a
 * native engine persona.
 *
 * ------------------------------------------------------------------
 * HONESTY RULES (audit §2 T2 — do not weaken):
 * - Matches score on whatever is recorded: the product's category
 *   TEXT field (products.category — there is no category_id /
 *   brand_id on the product row), the recorded price band, and
 *   product_attributes when any exist. Today 0 specs rows exist,
 *   so the only judgeable requirement is "Category fit".
 * - The engine's scorePct is shown as the raw engine score with
 *   its basis labelled — NEVER as a "95% match" / fit-percentage
 *   claim. Threshold rules from services/alternative-recommender.ts
 *   apply: no percentage claim the data cannot support.
 * - MATCH THRESHOLD: with no specs recorded, a product qualifies
 *   as a match ONLY when scorePersona reports categoryMatch. The
 *   engine verdict (matchVerdict) is NOT shown while every spec
 *   requirement is unknown: a category fit earns 1 of 7–8 weight
 *   (scorePct 13–14), which matchVerdict would label "Not ideal"
 *   — that would mislabel a genuine category fit, and dressing
 *   the same number up as a fit percentage would overclaim. Once
 *   specs are recorded and at least one spec requirement is
 *   judged, the engine verdict applies normally.
 * - Budget is a HARD filter: a product above the budget, or with
 *   no recorded price when a budget is set, is never a match.
 * - No match above threshold → empty list (honest empty state),
 *   never a forced pick.
 * - Every result carries PERSONA_FIT_SCORING_NOTE.
 */

import {
  getPersona,
  matchVerdict,
  scorePersona,
  type Persona,
  type PersonaAttributeInput,
  type PersonaId,
  type PersonaScore,
  type PersonaVerdict,
} from '@/services/persona-matcher';

/** The six personas the finder offers. */
export type UiPersonaId =
  | 'student'
  | 'creator'
  | 'gamer'
  | 'traveler'
  | 'home-office'
  | 'fitness';

export interface UiPersona {
  id: UiPersonaId;
  label: string;
  description: string;
  /** Engine persona this UI persona scores with (see header). */
  enginePersonaId: PersonaId;
  /** Shown on the page — states the mapping honestly. */
  mappingNote: string;
}

export const UI_PERSONAS: UiPersona[] = [
  {
    id: 'student',
    label: 'Student',
    description: 'Study, notes and classes on a budget-friendly device.',
    enginePersonaId: 'student',
    mappingNote: 'Scored with the engine’s Student persona.',
  },
  {
    id: 'creator',
    label: 'Creator',
    description: 'Photo, video and audio work — editing, shooting, streaming.',
    enginePersonaId: 'content',
    mappingNote:
      'Scored with the engine’s Content Creation persona (photo, video and audio work).',
  },
  {
    id: 'gamer',
    label: 'Gamer',
    description: 'High-performance play — demanding games, smooth frame rates.',
    enginePersonaId: 'gaming',
    mappingNote: 'Scored with the engine’s Gaming persona.',
  },
  {
    id: 'traveler',
    label: 'Traveler',
    description: 'Everyday productivity on the move.',
    enginePersonaId: 'work',
    mappingNote:
      'The engine has no Traveler persona, so this scores with the Work persona ' +
      '(everyday productivity). Nothing travel-specific is scored — no weight, ' +
      'battery-life or portability data is recorded.',
  },
  {
    id: 'home-office',
    label: 'Home Office',
    description: 'Everyday productivity at a desk.',
    enginePersonaId: 'work',
    mappingNote:
      'The engine has no Home Office persona, so this scores with the Work persona ' +
      '(everyday productivity). No desk-setup data is recorded or scored.',
  },
  {
    id: 'fitness',
    label: 'Fitness',
    description: 'Activity tracking and training.',
    enginePersonaId: 'work',
    mappingNote:
      'The engine has no Fitness persona, so this scores with the closest generic ' +
      'persona, the Work persona. No fitness, health or activity data is recorded, and a ' +
      'wearable does not earn a category fit from Work’s categories.',
  },
];

export function getUiPersona(id: string | null | undefined): UiPersona | null {
  if (!id) return null;
  return UI_PERSONAS.find((p) => p.id === id) ?? null;
}

/** Carried on every result (audit §2 T2). */
export const PERSONA_FIT_SCORING_NOTE =
  'Scored on category and price only — no specs recorded yet.';

/** Minimal product shape the ranker needs (from getProducts + prices + attributes). */
export interface PersonaFitProductInput {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  /** Category TEXT field from the products row (may be null). */
  category: string | null;
  /** Lowest recorded in-stock price, or null when unpriced. */
  priceUsd: number | null;
  dataFreshness: string;
  /** Recorded product_attributes (empty today — 0 specs rows). */
  attributes: PersonaAttributeInput[];
}

export interface PersonaFitMatch {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  category: string | null;
  priceUsd: number | null;
  dataFreshness: string;
  /** Raw engine score (category + specs, specs unknown today). */
  score: PersonaScore;
  /**
   * Engine verdict — null while NO spec requirement could be
   * judged (see header: showing "Not ideal" for a 13/100
   * category-only score would mislabel a genuine category fit).
   */
  verdict: PersonaVerdict | null;
  /** True when at least one spec requirement was judged. */
  specsJudged: boolean;
}

export interface PersonaFitParams {
  persona: UiPersona | null;
  personaError: string | null;
  budgetUsd: number | null;
  budgetError: string | null;
  /** True when the visitor submitted the form at all. */
  hasQuery: boolean;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Parse ?persona=<ui-persona-id>&budget=<usd> from the page's GET
 * form. An unknown persona id or a non-positive budget is an error,
 * not a silent default — the page shows the error and no results.
 */
export function parsePersonaFitParams(searchParams: {
  persona?: string | string[];
  budget?: string | string[];
}): PersonaFitParams {
  const rawPersona = firstParam(searchParams.persona);
  const rawBudget = firstParam(searchParams.budget);
  const hasQuery = rawPersona !== undefined || rawBudget !== undefined;

  let persona: UiPersona | null = null;
  let personaError: string | null = null;
  if (rawPersona !== undefined && rawPersona !== '') {
    persona = getUiPersona(rawPersona);
    if (!persona) {
      personaError = `Unknown persona “${rawPersona}” — pick one of ${UI_PERSONAS.map((p) => p.label).join(', ')}.`;
    }
  }

  let budgetUsd: number | null = null;
  let budgetError: string | null = null;
  if (rawBudget !== undefined && rawBudget.trim() !== '') {
    const cleaned = rawBudget.replace(/[$,\s]/g, '');
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      budgetError = 'Budget must be a positive number in USD, e.g. 1000.';
    } else {
      budgetUsd = parsed;
    }
  }

  return { persona, personaError, budgetUsd, budgetError, hasQuery };
}

/** True when the engine judged at least one spec requirement. */
function specsWereJudged(score: PersonaScore): boolean {
  return (
    score.matched.some((m) => m.requirement.id !== 'category') ||
    score.below.some((m) => m.requirement.id !== 'category')
  );
}

/**
 * Rank catalog products for one engine persona.
 *
 * - Budget (when set) is a hard filter: over-budget or unpriced
 *   products are dropped, never shown as matches.
 * - A product qualifies ONLY on a category fit (score.categoryMatch)
 *   — the only requirement judgeable while 0 specs rows exist.
 * - Order: engine scorePct desc (null last), then lowest recorded
 *   price asc (unpriced last — only possible with no budget set),
 *   then name A–Z. Deterministic, no ties left to chance.
 * - Returns [] — never a forced pick — when nothing qualifies.
 */
export function rankPersonaMatches(
  persona: Persona,
  products: PersonaFitProductInput[],
  budgetUsd: number | null
): PersonaFitMatch[] {
  const matches: PersonaFitMatch[] = [];
  for (const product of products) {
    if (budgetUsd !== null) {
      if (product.priceUsd === null || product.priceUsd > budgetUsd) continue;
    }
    const score = scorePersona(persona, product.attributes ?? [], product.category);
    if (!score.categoryMatch) continue;
    const specsJudged = specsWereJudged(score);
    matches.push({
      id: product.id,
      slug: product.slug,
      name: product.name,
      brand: product.brand,
      category: product.category,
      priceUsd: product.priceUsd,
      dataFreshness: product.dataFreshness,
      score,
      verdict: specsJudged ? matchVerdict(score.scorePct) : null,
      specsJudged,
    });
  }
  matches.sort((a, b) => {
    const sa = a.score.scorePct;
    const sb = b.score.scorePct;
    if (sa !== null && sb !== null && sa !== sb) return sb - sa;
    if (sa === null && sb !== null) return 1;
    if (sa !== null && sb === null) return -1;
    const pa = a.priceUsd;
    const pb = b.priceUsd;
    if (pa !== null && pb !== null && pa !== pb) return pa - pb;
    if (pa === null && pb !== null) return 1;
    if (pa !== null && pb === null) return -1;
    return a.name.localeCompare(b.name);
  });
  return matches;
}

/** Engine persona for a UI persona (the mapping under test). */
export function enginePersonaFor(uiPersona: UiPersona): Persona {
  return getPersona(uiPersona.enginePersonaId);
}
