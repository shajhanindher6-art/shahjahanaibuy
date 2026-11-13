/**
 * FINAL 100% — spec value normalization (F-P2-35).
 *
 * Spec values are free text, so the same recorded fact arrives in
 * many spellings: "16 GB" vs "16GB" vs "sixteen GB", "200 MP" vs
 * "200MP", "Apple M4" vs "apple m4". The template validator checks
 * the KEY and the UNIT, never the VALUE shape, so those spellings
 * were stored verbatim and a spec-matrix cell for the same value
 * could read differently on two products.
 *
 * This module normalizes at WRITE time (called from
 * `validateSpecEntries` via `normalizeSpecEntry`, so every writer
 * — pipeline, admin, CSV intake — gets the same canonical form):
 *
 * - Whitespace is collapsed; the value is trimmed.
 * - A number word ("one".."twenty", "thirty", "forty", ...) at the
 *   start of a value becomes digits ("sixteen GB" → "16 GB").
 * - A number glued to its unit is spaced ("16GB" → "16 GB",
 *   "200MP" → "200 MP", "6.1inch" → "6.1 inch").
 * - A supplied unit is appended only when the value does not
 *   already carry it ("16" + unit GB → "16 GB"); a value that
 *   already ends with the unit is left alone.
 * - Decimal commas in a leading number become decimal points
 *   ("6,1 inch" → "6.1 inch").
 *
 * Deliberately conservative: it never guesses a value, never
 * changes a name ("Apple M4" stays "Apple M4" — the "M4" is not a
 * measurement), and never invents a unit. A value it cannot parse
 * is returned unchanged. Normalization is idempotent: running it
 * twice gives the same string.
 */

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};

/** Units normalization recognises (case-insensitive, canonical case kept). */
export const NORMALIZABLE_UNITS = [
  'GB', 'TB', 'MB', 'KB', 'MP', 'Wh', 'mAh', 'Hz', 'mm', 'cm', 'inch', 'in',
  'g', 'kg', 'hours', 'hour', 'days', 'day', 'W',
] as const;

export interface NormalizedSpecValue {
  /** Canonical value (unchanged when nothing could be normalized). */
  value: string;
  /** True when the returned value differs from the input. */
  changed: boolean;
}

/**
 * Normalize one free-text spec value. Pure. Never throws on
 * malformed input — an unparseable value is returned unchanged.
 */
export function normalizeSpecValue(
  rawValue: string,
  unit?: string | null
): NormalizedSpecValue {
  const original = rawValue;
  let value = rawValue.trim().replace(/\s+/g, ' ');
  if (value === '') return { value: original, changed: false };

  // Number word at the start → digits ("sixteen GB" → "16 GB",
  // "sixteen" alone → "16"). Only the first word is converted.
  const firstWord = value.split(' ')[0].toLowerCase();
  if (NUMBER_WORDS[firstWord] !== undefined) {
    value = value.replace(/^[A-Za-z]+/, String(NUMBER_WORDS[firstWord]));
  }

  // Decimal comma in a leading number → decimal point.
  value = value.replace(/^(\d+),(\d+)/, '$1.$2');

  // Number glued to a unit → spaced ("16GB" → "16 GB", "200MP" →
  // "200 MP", "6.1inch" → "6.1 inch"). Only when the glued suffix
  // is a known unit, so model names like "M4" are untouched.
  const glued = /^(\d+(?:\.\d+)?)([A-Za-z]+)$/.exec(value);
  if (glued) {
    const suffix = glued[2];
    const known = NORMALIZABLE_UNITS.find(
      (u) => u.toLowerCase() === suffix.toLowerCase()
    );
    if (known) value = `${glued[1]} ${known}`;
  }

  // A bare number with a supplied unit gains it ("16" + GB →
  // "16 GB"); a value already ending with the unit is untouched.
  const cleanUnit = unit?.trim() ? unit.trim() : null;
  if (cleanUnit && /^\d+(?:\.\d+)?$/.test(value)) {
    value = `${value} ${cleanUnit}`;
  }

  return { value, changed: value !== original };
}
