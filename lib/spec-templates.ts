/**
 * Section 20, §12 #28 — category spec templates (DATA definitions).
 *
 * Before this module the only spec key lists anywhere were
 * hardcoded UI choice lists in services/guided-finder.ts
 * (laptop: ram/storage, phone: storage/connectivity, ...) matched
 * against description text — no laptop/phone/tablet key list
 * existed as a data definition, and no intake path could validate
 * a spec key, value or unit. These templates are that definition:
 * the canonical spec keys per category, with the units each key
 * is recorded in. They describe what a spec IS, not what any
 * product HAS — the catalog still has 0 spec rows live, so a
 * template entry is never presented as a recorded value.
 *
 * Keys use the `product_attributes.key` vocabulary (lowercase,
 * e.g. `ram`, `storage`). Values are free text (a processor is
 * "Apple M4", a camera is "200 MP") — the validator checks the
 * KEY belongs to the category, the VALUE is non-empty, and a
 * supplied UNIT is one the key allows. It never guesses a value
 * for a missing spec, and an unknown category has no template,
 * so its specs cannot be validated (reported, not invented).
 *
 * Categories are matched case-insensitively on the template key
 * (`laptop`, `smartphone`, `tablet`); `phone` is accepted as an
 * alias of `smartphone` because the guided finder and the seed
 * both use "phone" as the category word.
 */

export interface SpecTemplateEntry {
  /** product_attributes.key for this spec. */
  key: string;
  /** Human label shown in admin / spec displays. */
  label: string;
  /**
   * Units this key may be recorded in. Absent = the value is a
   * name, not a measurement (processor, OS, network) and carries
   * no unit. When present, a supplied unit must be one of these;
   * omitting the unit is allowed (the value may carry it inline,
   * e.g. "16 GB").
   */
  units?: string[];
}

export type SpecTemplateCategory = 'laptop' | 'smartphone' | 'tablet';

/** Canonical spec keys per category, as data — not UI copy. */
export const SPEC_TEMPLATES: Record<SpecTemplateCategory, SpecTemplateEntry[]> = {
  laptop: [
    { key: 'processor', label: 'Processor' },
    { key: 'ram', label: 'RAM', units: ['GB'] },
    { key: 'storage', label: 'Storage', units: ['GB', 'TB'] },
    { key: 'display', label: 'Display', units: ['inch'] },
    { key: 'graphics', label: 'Graphics' },
    { key: 'battery', label: 'Battery', units: ['Wh', 'mAh', 'hours'] },
    { key: 'os', label: 'Operating system' },
  ],
  smartphone: [
    { key: 'processor', label: 'Processor' },
    { key: 'ram', label: 'RAM', units: ['GB'] },
    { key: 'storage', label: 'Storage', units: ['GB', 'TB'] },
    { key: 'display', label: 'Display', units: ['inch'] },
    { key: 'camera', label: 'Camera', units: ['MP'] },
    { key: 'battery', label: 'Battery', units: ['mAh', 'Wh'] },
    { key: 'network', label: 'Network' },
  ],
  tablet: [
    { key: 'processor', label: 'Processor' },
    { key: 'display', label: 'Display', units: ['inch'] },
    { key: 'storage', label: 'Storage', units: ['GB', 'TB'] },
    { key: 'ram', label: 'RAM', units: ['GB'] },
    { key: 'battery', label: 'Battery', units: ['mAh', 'Wh', 'hours'] },
    { key: 'connectivity', label: 'Connectivity' },
  ],
};

/** Category words that resolve to a template (`phone` → smartphone). */
const CATEGORY_ALIASES: Record<string, SpecTemplateCategory> = {
  laptop: 'laptop',
  laptops: 'laptop',
  smartphone: 'smartphone',
  smartphones: 'smartphone',
  phone: 'smartphone',
  phones: 'smartphone',
  'cell phone': 'smartphone',
  'cell phones': 'smartphone',
  tablet: 'tablet',
  tablets: 'tablet',
};

/** Resolve a free-text category to its template, or null when it has none. */
export function specTemplateForCategory(
  category: string | null | undefined
): SpecTemplateEntry[] | null {
  if (!category) return null;
  const resolved = CATEGORY_ALIASES[category.trim().toLowerCase()];
  return resolved ? SPEC_TEMPLATES[resolved] : null;
}

/** Canonical spec keys for a category (empty when it has no template). */
export function specKeysForCategory(category: string | null | undefined): string[] {
  return (specTemplateForCategory(category) ?? []).map((entry) => entry.key);
}

export interface SpecEntryInput {
  key: string;
  value: string;
  unit?: string | null;
}

export interface SpecValidationResult {
  valid: boolean;
  /** One error per bad entry (empty when valid). */
  errors: string[];
  /** Entries that passed, with canonical key + trimmed value/unit. */
  validEntries: SpecEntryInput[];
}

/**
 * Validate spec entries against a category's template.
 * Unknown category → every entry errors (no template to check
 * against — reported, never guessed). Unknown key, empty value
 * or a unit the key does not allow → that entry errors; valid
 * entries are still returned so a caller can store the good ones
 * and report the bad ones, never silently drop them.
 */
export function validateSpecEntries(
  category: string | null | undefined,
  entries: SpecEntryInput[]
): SpecValidationResult {
  const template = specTemplateForCategory(category);
  const errors: string[] = [];
  const validEntries: SpecEntryInput[] = [];
  if (!template) {
    return {
      valid: false,
      errors: [
        `No spec template for category "${category ?? ''}" — specs cannot be validated`,
      ],
      validEntries: [],
    };
  }
  const byKey = new Map(template.map((entry) => [entry.key, entry]));
  for (const entry of entries) {
    const key = entry.key.trim().toLowerCase();
    const value = entry.value.trim();
    const unit = entry.unit?.trim() ? entry.unit.trim() : undefined;
    const templateEntry = byKey.get(key);
    if (!templateEntry) {
      errors.push(
        `Unknown spec key "${entry.key}" for this category (known keys: ${template.map((e) => e.key).join(', ')})`
      );
      continue;
    }
    if (value === '') {
      errors.push(`Spec "${key}" has an empty value`);
      continue;
    }
    if (unit !== undefined && templateEntry.units && !templateEntry.units.includes(unit)) {
      errors.push(
        `Spec "${key}" unit "${unit}" is not allowed (allowed: ${templateEntry.units.join(', ')})`
      );
      continue;
    }
    if (unit !== undefined && !templateEntry.units) {
      errors.push(`Spec "${key}" takes no unit, got "${unit}"`);
      continue;
    }
    validEntries.push({ key, value, ...(unit ? { unit } : {}) });
  }
  return { valid: errors.length === 0, errors, validEntries };
}
