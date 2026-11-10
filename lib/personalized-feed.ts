/**
 * Personalized deals feed (S3#18) — privacy-first picks.
 *
 * The feed is built ONLY from the visitor's own data:
 * - guest wishlist (localStorage) and guest price alerts (localStorage)
 * - signed-in wishlist + alerts (fetched by the component, only when
 *   the visitor is signed in)
 *
 * Nothing is sent to another user, nothing is tracked across users,
 * and no browsing history ever leaves the device except for the single
 * deal-finder query the component posts (the query itself is just a
 * category/budget phrase built from the visitor's own saved items —
 * see buildPersonalizedQuery). With no signals at all the feed shows
 * an honest empty state instead of generic deals (the homepage
 * already has a generic deals widget for that).
 *
 * Pure helpers — unit-tested, no I/O.
 */

export type PersonalizedSignalKind = 'wishlist' | 'alert' | 'viewed';

export interface PersonalizedSignal {
  kind: PersonalizedSignalKind;
  productId: string;
  slug?: string | null;
  name: string;
  category?: string | null;
  brand?: string | null;
  /** The visitor's own target price (alert) — the only budget source. */
  targetPrice?: number | null;
}

export interface PersonalizedQuery {
  /** Deal-finder query phrase, e.g. "best laptop deals under $900". */
  query: string;
  /** Human reasons shown next to the picks ("Because you saved …"). */
  reasons: string[];
  /** Top categories from the visitor's signals (max 2, by frequency). */
  categories: string[];
  /** Lowest target price among the visitor's alerts, or null. */
  maxBudget: number | null;
  /** True when there were no usable signals at all. */
  empty: boolean;
}

function topCategories(signals: PersonalizedSignal[], limit = 2): string[] {
  const counts = new Map<string, number>();
  for (const s of signals) {
    const category = (s.category ?? '').trim();
    if (category) counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([category]) => category);
}

/**
 * Build the deal-finder query + explanations from the visitor's own
 * signals. Deterministic, no invented data: the budget comes only
 * from the visitor's own alert targets, and categories only from
 * products they actually saved or alerted on.
 */
export function buildPersonalizedQuery(
  signals: PersonalizedSignal[]
): PersonalizedQuery {
  const usable = signals.filter((s) => s.productId && s.name);
  if (usable.length === 0) {
    return { query: '', reasons: [], categories: [], maxBudget: null, empty: true };
  }

  const categories = topCategories(usable);
  const targets = usable
    .map((s) => s.targetPrice)
    .filter((t): t is number => typeof t === 'number' && Number.isFinite(t) && t > 0);
  const maxBudget = targets.length > 0 ? Math.min(...targets) : null;

  const categoryPhrase =
    categories.length > 0 ? categories.join(' and ') : 'tech';
  const query =
    maxBudget !== null
      ? `best ${categoryPhrase} deals under $${Math.round(maxBudget)}`
      : `best ${categoryPhrase} deals`;

  const reasons: string[] = [];
  const saved = usable.filter((s) => s.kind === 'wishlist').slice(0, 2);
  for (const s of saved) {
    reasons.push(`Because you saved ${s.name}`);
  }
  const alerted = usable.filter((s) => s.kind === 'alert').slice(0, 2);
  for (const s of alerted) {
    reasons.push(
      s.targetPrice
        ? `Because you set a $${s.targetPrice.toFixed(0)} alert on ${s.name}`
        : `Because you set an alert on ${s.name}`
    );
  }
  if (reasons.length === 0) {
    reasons.push('Based on products you looked at');
  }

  return { query, reasons, categories, maxBudget, empty: false };
}

export interface RankableProduct {
  id: string;
  category?: string | null;
  brand?: string | null;
}

/**
 * Rank deal-finder results by overlap with the visitor's own signals
 * (same category +2, same brand +1). Products with no overlap keep
 * their original order (stable sort) — nothing is hidden, the
 * visitor's own interests just come first.
 */
export function rankProductsBySignals<T extends RankableProduct>(
  products: T[],
  signals: PersonalizedSignal[]
): T[] {
  const categories = new Set(
    signals.map((s) => (s.category ?? '').toLowerCase()).filter(Boolean)
  );
  const brands = new Set(
    signals.map((s) => (s.brand ?? '').toLowerCase()).filter(Boolean)
  );
  const score = (p: T): number =>
    (categories.has((p.category ?? '').toLowerCase()) ? 2 : 0) +
    (brands.has((p.brand ?? '').toLowerCase()) ? 1 : 0);
  return products
    .map((product, index) => ({ product, index, score: score(product) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ product }) => product);
}
