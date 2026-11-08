/**
 * Persona Matcher — Option 15 Module 2.
 *
 * Deterministic, interactive "Will it fit my needs?" scoring. NO LLM,
 * NO invented specs: every point is earned from the product's REAL
 * recorded specifications (product_attributes) plus its real category.
 *
 * Honesty rules (do not weaken):
 * - A requirement is matched only when an attribute key matches AND
 *   its unit matches the requirement unit AND the parsed value is
 *   >= the requirement minimum. Wh and mAh are NEVER compared or
 *   converted — different units mean "unknown", never a failure.
 * - Missing key, unparseable value, or unit mismatch → unknown:
 *   0 points, listed as unknown, never guessed.
 * - Category fit counts as one requirement (weight 1, label
 *   "Category fit"); a missing category is unknown, not a mismatch.
 * - scorePct = round(100 * earnedWeight / totalWeight) across all
 *   requirements (judged + unknown). Unknown earns 0.
 * - scorePct is null only when there is nothing to judge at all:
 *   zero requirements AND no category.
 *
 * Numeric parsing reuses parseLeadingNumber from comparison-summary:
 * the leading number of a value ("16 GB" → 16, "1,000 mAh" → 1000).
 * A value with no leading number is unparseable → unknown.
 */

import { parseLeadingNumber } from '@/services/comparison-summary';

/** Units a persona requirement can demand. '' is reserved for a
    future unit-less requirement; no current persona uses it. */
export type PersonaUnit = 'GB' | 'Wh' | 'mAh' | '';

export type PersonaId = 'work' | 'gaming' | 'student' | 'content';

export interface PersonaRequirement {
  id: string;
  label: string;
  /** Matched against the attribute key, e.g. /ram|memory/i. */
  keyPattern: RegExp;
  /** Minimum acceptable value, in `unit`. */
  min: number;
  unit: PersonaUnit;
  weight: number;
}

export interface Persona {
  id: PersonaId;
  label: string;
  description: string;
  /** Real catalog categories this persona fits, e.g. 'Laptops'. */
  suitableCategories: string[];
  requirements: PersonaRequirement[];
}

/** A requirement as it appears in a score breakdown. `min`/`unit`
    are absent for the synthetic "Category fit" requirement. */
export interface PersonaRequirementRef {
  id: string;
  label: string;
  weight: number;
  min?: number;
  unit?: PersonaUnit;
}

export interface PersonaScoreEntry {
  requirement: PersonaRequirementRef;
  /** The real recorded value, e.g. "16 GB", or the category name. */
  actual: string;
}

export interface PersonaScoreUnknownEntry {
  requirement: PersonaRequirementRef;
}

export interface PersonaScore {
  /** Null only when nothing was judgeable (no requirements + no category). */
  scorePct: number | null;
  matched: PersonaScoreEntry[];
  below: PersonaScoreEntry[];
  unknown: PersonaScoreUnknownEntry[];
  categoryMatch: boolean;
}

/** Minimal attribute shape the scorer needs — ProductAttribute
    satisfies it (extra fields are fine). */
export interface PersonaAttributeInput {
  key: string;
  value: string;
  unit: string | null;
}

// ---------------------------------------------------------------------------
// Personas — all thresholds are visible constants, not hidden magic.
// RAM/Storage thresholds are in GB, battery in Wh. A device whose
// battery is recorded in mAh scores "unknown" on battery, never a
// converted guess.
// ---------------------------------------------------------------------------

export const PERSONAS: Persona[] = [
  {
    id: 'work',
    label: 'Work',
    description: 'Everyday productivity — documents, browsing and video calls.',
    suitableCategories: ['Laptops', 'Smartphones'],
    requirements: [
      { id: 'ram', label: 'RAM', keyPattern: /ram|memory/i, min: 16, unit: 'GB', weight: 3 },
      { id: 'storage', label: 'Storage', keyPattern: /storage|ssd/i, min: 512, unit: 'GB', weight: 2 },
      { id: 'battery', label: 'Battery', keyPattern: /battery/i, min: 50, unit: 'Wh', weight: 2 },
    ],
  },
  {
    id: 'gaming',
    label: 'Gaming',
    description: 'High-performance play — demanding games, smooth frame rates.',
    suitableCategories: ['Laptops', 'Smartphones'],
    requirements: [
      { id: 'ram', label: 'RAM', keyPattern: /ram|memory/i, min: 32, unit: 'GB', weight: 3 },
      { id: 'storage', label: 'Storage', keyPattern: /storage|ssd/i, min: 1000, unit: 'GB', weight: 2 },
      { id: 'battery', label: 'Battery', keyPattern: /battery/i, min: 70, unit: 'Wh', weight: 1 },
    ],
  },
  {
    id: 'student',
    label: 'Student',
    description: 'Study, notes and classes on a budget-friendly device.',
    suitableCategories: ['Laptops', 'Smartphones'],
    requirements: [
      { id: 'ram', label: 'RAM', keyPattern: /ram|memory/i, min: 8, unit: 'GB', weight: 3 },
      { id: 'storage', label: 'Storage', keyPattern: /storage|ssd/i, min: 256, unit: 'GB', weight: 2 },
      { id: 'battery', label: 'Battery', keyPattern: /battery/i, min: 40, unit: 'Wh', weight: 2 },
    ],
  },
  {
    id: 'content',
    label: 'Content Creation',
    description: 'Photo, video and audio work — editing, shooting, streaming.',
    suitableCategories: ['Laptops', 'Cameras', 'Smartphones'],
    requirements: [
      { id: 'ram', label: 'RAM', keyPattern: /ram|memory/i, min: 16, unit: 'GB', weight: 3 },
      { id: 'storage', label: 'Storage', keyPattern: /storage|ssd/i, min: 512, unit: 'GB', weight: 2 },
      { id: 'battery', label: 'Battery', keyPattern: /battery/i, min: 60, unit: 'Wh', weight: 1 },
    ],
  },
];

export function getPersona(id: PersonaId): Persona {
  return PERSONAS.find((p) => p.id === id) ?? PERSONAS[0];
}

/** Display value for one attribute: the stored value plus its unit
    when one exists ("16 GB"). Mirrors formatAttributeValue in
    lib/product-attributes (kept local here because the scorer takes
    the minimal {key, value, unit} shape, not full ProductAttribute rows). */
function displayValue(value: string, unit: string | null): string {
  const v = (value ?? '').trim();
  if (v === '') return '';
  return unit ? `${v} ${unit}` : v;
}

/** The unit an attribute speaks: its stored unit, else the unit
    trailing its value ("16 GB" → "gb"). Null when neither exists. */
function resolveUnit(
  attr: PersonaAttributeInput,
  parsed: ReturnType<typeof parseLeadingNumber>
): string | null {
  if (attr.unit && attr.unit !== '') return attr.unit;
  return parsed?.trailingUnit ?? null;
}

function toRef(req: PersonaRequirement): PersonaRequirementRef {
  return { id: req.id, label: req.label, weight: req.weight, min: req.min, unit: req.unit };
}

/**
 * Judge one requirement against the product's attributes.
 * Returns null when the requirement cannot be judged honestly
 * (no matching key, no row in the required unit, or an unparseable
 * value) — the caller lists it as unknown.
 */
function judgeRequirement(
  req: PersonaRequirement,
  attributes: PersonaAttributeInput[]
): { matched: boolean; actual: string } | null {
  const candidates = (attributes ?? []).filter((a) =>
    req.keyPattern.test((a.key ?? '').trim())
  );
  // Keep only rows whose unit matches the required unit. A battery
  // recorded in mAh never competes with a Wh requirement.
  const unitMatches = candidates.filter((a) => {
    const parsed = parseLeadingNumber(a.value);
    const unit = resolveUnit(a, parsed);
    return unit !== null && unit.toLowerCase() === req.unit.toLowerCase();
  });
  // First unit-matching row with a parseable number wins.
  for (const attr of unitMatches) {
    const parsed = parseLeadingNumber(attr.value);
    if (!parsed || !Number.isFinite(parsed.num)) continue;
    return {
      matched: parsed.num >= req.min,
      actual: displayValue(attr.value, attr.unit),
    };
  }
  return null;
}

/**
 * Score one product for one persona, from its recorded attributes
 * and its real category only. Unknown requirements earn 0 points
 * and appear in `unknown`; the category is one requirement (weight
 * 1, label "Category fit"). scorePct is null only when there is
 * nothing to judge: zero requirements AND no category.
 */
export function scorePersona(
  persona: Persona,
  attributes: PersonaAttributeInput[],
  category: string | null
): PersonaScore {
  const matched: PersonaScoreEntry[] = [];
  const below: PersonaScoreEntry[] = [];
  const unknown: PersonaScoreUnknownEntry[] = [];
  let earned = 0;
  let total = 0;

  for (const req of persona.requirements) {
    total += req.weight;
    const ref = toRef(req);
    const judged = judgeRequirement(req, attributes ?? []);
    if (judged === null) {
      unknown.push({ requirement: ref });
    } else if (judged.matched) {
      earned += req.weight;
      matched.push({ requirement: ref, actual: judged.actual });
    } else {
      below.push({ requirement: ref, actual: judged.actual });
    }
  }

  // Category fit — one requirement, weight 1.
  const categoryWeight = 1;
  const categoryRef: PersonaRequirementRef = {
    id: 'category',
    label: 'Category fit',
    weight: categoryWeight,
  };
  const normalizedCategory = (category ?? '').trim();
  const categoryMatch =
    normalizedCategory !== '' &&
    persona.suitableCategories.some(
      (c) => c.toLowerCase() === normalizedCategory.toLowerCase()
    );
  if (normalizedCategory === '') {
    unknown.push({ requirement: categoryRef });
  } else {
    total += categoryWeight;
    if (categoryMatch) {
      earned += categoryWeight;
      matched.push({ requirement: categoryRef, actual: normalizedCategory });
    } else {
      below.push({ requirement: categoryRef, actual: normalizedCategory });
    }
  }

  const scorePct =
    persona.requirements.length === 0 && normalizedCategory === ''
      ? null
      : total === 0
        ? null
        : Math.round((100 * earned) / total);

  return { scorePct, matched, below, unknown, categoryMatch };
}

export type PersonaVerdict = 'Great fit' | 'Good fit' | 'Not ideal';

/**
 * Verdict for a score: Great fit >= 80, Good fit 50–79,
 * Not ideal < 50. Null when there was nothing to judge.
 */
export function matchVerdict(scorePct: number | null): PersonaVerdict | null {
  if (scorePct === null) return null;
  if (scorePct >= 80) return 'Great fit';
  if (scorePct >= 50) return 'Good fit';
  return 'Not ideal';
}
