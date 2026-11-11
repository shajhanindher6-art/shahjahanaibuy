/**
 * "Complete your setup" affinity picks (Section 14, Chunk 2, B12).
 *
 * A static category-affinity map — NOT purchase data. There is no
 * "frequently bought together" anywhere (no purchase / co-occurrence
 * data exists), so the product page shows a labelled suggestion row
 * instead: "Pairs well with — suggestion, not purchase data".
 *
 * Pure and deterministic: given the current product's category and
 * priced catalog candidates, return up to `limit` picks — cheapest
 * priced product per affinity category, in map order, never the
 * current product itself and never a product from the current
 * product's own category. Unpriced candidates are dropped.
 */

/** Affinity categories per product category, in preference order.
 *  Keys and values are lower-cased category fragments, matched
 *  with the same contains-either-way rule the guided finder uses
 *  (so "Laptops" matches "laptop" and vice versa). */
export const SETUP_AFFINITY: Record<string, string[]> = {
  laptop: ['headphones', 'mouse', 'monitor'],
  phone: ['watch', 'headphones'],
  camera: ['monitor', 'headphones'],
  watch: ['headphones', 'phone'],
  headphones: ['phone', 'laptop'],
  tv: ['speaker', 'headphones'],
  tablet: ['headphones', 'keyboard'],
  gaming: ['headphones', 'monitor'],
  monitor: ['keyboard', 'mouse'],
  speaker: ['phone', 'tv'],
  keyboard: ['mouse', 'monitor'],
  mouse: ['keyboard', 'monitor'],
};

export interface AffinityCandidate {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  category: string | null;
  /** Verified selling price in USD; null/<=0 rows are dropped. */
  price: number | null;
}

export interface AffinityPick extends AffinityCandidate {
  /** The affinity category this pick fills (e.g. 'headphones'). */
  affinityCategory: string;
}

function categoryMatches(candidateCategory: string | null, wanted: string): boolean {
  if (!candidateCategory) return false;
  const c = candidateCategory.toLowerCase();
  const w = wanted.toLowerCase();
  return c.includes(w) || w.includes(c);
}

/** Singular form for category comparison ("Laptops" -> "laptop",
 *  "Watches" -> "watch", "Phones" -> "phone"). Only an -es ending
 *  after s/x/z/ch/sh is stripped as -es ("watches" -> "watch");
 *  otherwise a lone trailing -s goes ("phones" -> "phone", NOT
 *  "phon"). Used for the affinity-map lookup and the
 *  same-category check below. */
function normalizeCategory(category: string): string {
  const lower = category.toLowerCase().trim();
  if (/(s|x|z|ch|sh)es$/.test(lower)) return lower.replace(/es$/, '');
  if (lower.endsWith('s')) return lower.slice(0, -1);
  return lower;
}

/** Affinity list for a category, tolerating plural category names
 *  ("Laptops" finds the "laptop" entry). */
function affinityFor(category: string): string[] | undefined {
  const lower = category.toLowerCase().trim();
  return SETUP_AFFINITY[lower] ?? SETUP_AFFINITY[normalizeCategory(lower)];
}

function isSameCategory(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  // Normalized EQUALITY, not contains(): a contains-check would
  // call "Phones" the same category as "Headphones" ("headPHONES"
  // contains "phones").
  return normalizeCategory(a) === normalizeCategory(b);
}

/**
 * Affinity picks for a product. Returns [] when the category has
 * no affinity entry, or when no priced candidate fills any
 * affinity slot — the section then renders nothing, never a
 * forced or unpriced pick.
 */
export function getSetupAffinity(
  currentCategory: string | null,
  currentId: string,
  candidates: AffinityCandidate[],
  limit = 3
): AffinityPick[] {
  if (!currentCategory) return [];
  const wanted = affinityFor(currentCategory);
  if (!wanted || wanted.length === 0) return [];

  const picks: AffinityPick[] = [];
  for (const affinityCategory of wanted) {
    if (picks.length >= limit) break;
    // Cheapest priced candidate in this affinity category (not
    // the current product, not its own category). Deterministic:
    // price, then slug.
    const inCategory = candidates
      .filter(
        (c) =>
          c.id !== currentId &&
          c.price !== null &&
          Number.isFinite(c.price) &&
          (c.price as number) > 0 &&
          !isSameCategory(c.category, currentCategory) &&
          categoryMatches(c.category, affinityCategory)
      )
      .sort((a, b) => (a.price as number) - (b.price as number) || a.slug.localeCompare(b.slug));
    const best = inCategory[0];
    if (best) {
      picks.push({ ...best, price: best.price, affinityCategory });
    }
  }
  return picks;
}
