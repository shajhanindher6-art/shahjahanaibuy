/**
 * True Fake Review & Paid Rating Filter — pattern analysis over the
 * product's REAL reviews. It reads the same reviews table as the
 * sentiment engine and never contradicts it; it only adds
 * authenticity pattern checks on top.
 *
 * HONESTY RULES (do not weaken them) — thresholds are STATED here
 * and in the UI, so a badge is never a black box:
 * - With 0 reviews the result is "No reviews to analyze": no score,
 *   no badge, no rating. Nothing is analyzed from nothing.
 * - A warning badge requires EITHER a strong signal (rating skew,
 *   a duplicate-text cluster, or a timing burst) OR at least two
 *   weak signals (high unverified ratio, high short/generic ratio).
 *   A single weak signal alone NEVER triggers a badge.
 * - Badge wording is patterns, not proof: "Some reviews show
 *   patterns consistent with incentivized reviews — treat ratings
 *   with caution". No individual reviewer is ever named or accused.
 * - The "unbiased real rating" is the average of the TRUSTED subset
 *   only: reviews that are NOT in a duplicate cluster AND (are
 *   verified OR are not short/generic). Burst timing is a set-level
 *   signal — it contributes to the badge but never excludes an
 *   individual review, because a burst alone does not prove any one
 *   review is fake. The trusted average is shown ONLY when the
 *   trusted subset is non-empty, next to the overall average with
 *   both counts.
 * - This analyzer detects patterns; it does not prove a review was
 *   paid for. The UI must say so.
 */

/** Minimal review shape the analyzer needs (matches the page's Review). */
export interface AuthenticityReview {
  id: string;
  rating: number;
  title: string | null;
  content: string | null;
  verifiedPurchase: boolean;
  createdAt: string;
}

/** Stated thresholds — change them here and the UI text follows. */
export const AUTH_THRESHOLDS = {
  /** Minimum reviews before ANY pattern badge can fire. */
  minReviewsForBadge: 10,
  /** Five-star share that counts as skew (with minReviewsForBadge). */
  skewFiveStarShare: 0.9,
  /** Minimum duplicate-cluster size that counts as a strong signal. */
  duplicateClusterMin: 3,
  /** Word-set Jaccard similarity that counts two texts as near-duplicates. */
  nearDuplicateSimilarity: 0.9,
  /** Rolling window for a timing burst. */
  burstWindowHours: 24,
  /** Reviews inside one burst window that count as a burst. */
  burstMinReviews: 5,
  /** Unverified share that counts as a weak signal. */
  unverifiedShareWeak: 0.8,
  /** Short/generic share that counts as a weak signal. */
  shortGenericShareWeak: 0.5,
  /** Content shorter than this (chars) counts as short/generic. */
  shortContentChars: 20,
};

export interface AuthenticitySignal {
  key: string;
  /** 'strong' | 'weak' | 'none' — only strong/weak feed the badge rule. */
  strength: 'strong' | 'weak' | 'none';
  detail: string;
}

export interface AuthenticityResult {
  totalReviews: number;
  /** Overall average rating (all reviews), or null when none. */
  overallAverage: number | null;
  /** Trusted-subset average, or null when the subset is empty. */
  trustedAverage: number | null;
  /** Reviews in the trusted subset. */
  trustedCount: number;
  /** Whether the warning badge should render. */
  showWarning: boolean;
  signals: AuthenticitySignal[];
}

function normalizeText(title: string | null, content: string | null): string {
  return `${title ?? ''} ${content ?? ''}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordSet(text: string): Set<string> {
  return new Set(text.split(' ').filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Pure analyzer. Deterministic: same reviews in → same result out.
 * Never touches the network, never invents a review.
 */
export function analyzeReviewAuthenticity(reviews: AuthenticityReview[]): AuthenticityResult {
  const total = reviews.length;
  if (total === 0) {
    return {
      totalReviews: 0,
      overallAverage: null,
      trustedAverage: null,
      trustedCount: 0,
      showWarning: false,
      signals: [],
    };
  }
  const overallAverage =
    reviews.reduce((sum, r) => sum + (Number.isFinite(r.rating) ? r.rating : 0), 0) / total;

  // --- Duplicate / near-duplicate clusters (per-review exclusion) ---
  const normalized = reviews.map((r) => normalizeText(r.title, r.content));
  const sets = normalized.map(wordSet);
  const inDuplicateCluster = new Set<number>();
  for (let i = 0; i < reviews.length; i++) {
    for (let j = i + 1; j < reviews.length; j++) {
      if (normalized[i] && normalized[i] === normalized[j]) {
        inDuplicateCluster.add(i);
        inDuplicateCluster.add(j);
      } else if (
        normalized[i] &&
        normalized[j] &&
        jaccard(sets[i], sets[j]) >= AUTH_THRESHOLDS.nearDuplicateSimilarity
      ) {
        inDuplicateCluster.add(i);
        inDuplicateCluster.add(j);
      }
    }
  }
  // Cluster size = largest group sharing one normalized text.
  const textCounts = new Map<string, number>();
  for (const t of normalized) {
    if (t) textCounts.set(t, (textCounts.get(t) ?? 0) + 1);
  }
  const largestCluster = Math.max(0, ...textCounts.values());

  // --- Per-review trust + trusted subset ---
  const isShort = (r: AuthenticityReview) =>
    (r.content ?? '').trim().length < AUTH_THRESHOLDS.shortContentChars &&
    (r.title ?? '').trim().length < AUTH_THRESHOLDS.shortContentChars;
  const trusted = reviews.filter(
    (_, i) => !inDuplicateCluster.has(i) && (reviews[i].verifiedPurchase || !isShort(reviews[i]))
  );
  const trustedAverage =
    trusted.length > 0
      ? trusted.reduce((sum, r) => sum + (Number.isFinite(r.rating) ? r.rating : 0), 0) /
        trusted.length
      : null;

  // --- Set-level signals (badge rule needs min reviews) ---
  const signals: AuthenticitySignal[] = [];
  const canBadge = total >= AUTH_THRESHOLDS.minReviewsForBadge;
  const fiveStar = reviews.filter((r) => r.rating === 5).length;
  const fiveStarShare = fiveStar / total;
  if (canBadge && fiveStarShare >= AUTH_THRESHOLDS.skewFiveStarShare) {
    signals.push({
      key: 'rating-skew',
      strength: 'strong',
      detail: `${Math.round(fiveStarShare * 100)}% of reviews are five-star (${fiveStar} of ${total}), which is unusually skewed.`,
    });
  }
  if (canBadge && largestCluster >= AUTH_THRESHOLDS.duplicateClusterMin) {
    signals.push({
      key: 'duplicate-text',
      strength: 'strong',
      detail: `${largestCluster} reviews share near-identical text, which is unusual for independent buyers.`,
    });
  }
  // Timing burst: max reviews inside any rolling 24h window.
  const times = reviews
    .map((r) => new Date(r.createdAt).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  let maxInWindow = 0;
  for (let i = 0; i < times.length; i++) {
    let count = 0;
    for (let j = i; j < times.length; j++) {
      if (times[j] - times[i] <= AUTH_THRESHOLDS.burstWindowHours * 3600 * 1000) count++;
      else break;
    }
    maxInWindow = Math.max(maxInWindow, count);
  }
  if (canBadge && maxInWindow >= AUTH_THRESHOLDS.burstMinReviews) {
    signals.push({
      key: 'timing-burst',
      strength: 'strong',
      detail: `${maxInWindow} reviews arrived within 24 hours, a burst pattern worth noting.`,
    });
  }
  const unverifiedShare = reviews.filter((r) => !r.verifiedPurchase).length / total;
  if (canBadge && unverifiedShare >= AUTH_THRESHOLDS.unverifiedShareWeak) {
    signals.push({
      key: 'unverified-ratio',
      strength: 'weak',
      detail: `${Math.round(unverifiedShare * 100)}% of reviews are unverified purchases.`,
    });
  }
  const shortShare = reviews.filter(isShort).length / total;
  if (canBadge && shortShare >= AUTH_THRESHOLDS.shortGenericShareWeak) {
    signals.push({
      key: 'short-generic',
      strength: 'weak',
      detail: `${Math.round(shortShare * 100)}% of reviews are very short or generic.`,
    });
  }
  const strong = signals.filter((s) => s.strength === 'strong').length;
  const weak = signals.filter((s) => s.strength === 'weak').length;
  // Badge rule (stated): one strong signal, or two weak signals. A
  // single weak signal alone never triggers a badge.
  const showWarning = strong >= 1 || weak >= 2;

  return {
    totalReviews: total,
    overallAverage: round1(overallAverage),
    trustedAverage: trustedAverage !== null ? round1(trustedAverage) : null,
    trustedCount: trusted.length,
    showWarning,
    signals,
  };
}
