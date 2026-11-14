/**
 * Shared price-state reason strings (Master Tool Integration, S2-6).
 *
 * ONE builder for the user-visible reason sentences produced by
 * BOTH lib/verification/price-state.ts (the brief's 5-state price
 * machine) and lib/verification/fully-verified.ts (the whole-record
 * "fully verified" freshPrice criterion). The two modules describe
 * the same verification facts from different angles, and their
 * wordings had drifted into near-duplicates ("checked by a real
 * fetch" vs "verified by a real fetch", "verified once" vs
 * "verified") — close enough to confuse a reader, different
 * enough that neither could simply copy the other.
 *
 * The builder functions below are parameterized ONLY where the two
 * call sites genuinely differ (verb, window clause, "once",
 * trailing suffix). Every combination produces EXACTLY the string
 * its call site produced before this refactor — no wording changed.
 * The shared parts (the "N day(s)" plural, the "older than N days"
 * clause, the sentence shapes) live here once, so a future wording
 * fix lands in both places together.
 *
 * Callers append their own trailing notes AFTER the builder's
 * string (e.g. price-state.ts appends `sourceNote`); the builder
 * never knows about caller-specific suffixes.
 */

/** "1 day" / "2 days" — the one plural rule for every reason. */
export function pluralDays(age: number): string {
  return `${age} day${age === 1 ? '' : 's'}`;
}

/**
 * Fresh verified check: "The price was <verb> by a real fetch
 * <age> day(s) ago[ , within the <staleDays>-day freshness window]."
 *
 * - price-state.ts LIVE_VERIFIED: verb 'checked', windowClause true.
 * - fully-verified.ts freshPrice pass: verb 'verified', windowClause false.
 */
export function freshVerifiedCheckReason(
  age: number,
  staleDays: number,
  opts: { verb: 'checked' | 'verified'; windowClause: boolean }
): string {
  const base = `The price was ${opts.verb} by a real fetch ${pluralDays(age)} ago`;
  return opts.windowClause
    ? `${base}, within the ${staleDays}-day freshness window.`
    : `${base}.`;
}

/**
 * Expired verified check: "The price was verified[ once], but the
 * check is <age> days old — older than <staleDays> days[ , so the
 * verification has expired]."
 *
 * - price-state.ts HISTORICAL_VERIFIED (aged): once true, expiredSuffix true.
 * - fully-verified.ts freshPrice fail (aged): once false, expiredSuffix false.
 */
export function expiredVerifiedCheckReason(
  age: number,
  staleDays: number,
  opts: { once: boolean; expiredSuffix: boolean }
): string {
  const base = `The price was verified${opts.once ? ' once' : ''}, but the check is ${pluralDays(age)} old — older than ${staleDays} days`;
  return opts.expiredSuffix ? `${base}, so the verification has expired.` : `${base}.`;
}

/**
 * Verified stamp with no check date: "The price carries a verified
 * stamp, but no check date is recorded[ , so the verification cannot
 * be shown as current]."
 *
 * - price-state.ts HISTORICAL_VERIFIED (dateless): cannotBeShownCurrent true.
 * - fully-verified.ts freshPrice fail (dateless): cannotBeShownCurrent false.
 */
export function datelessVerifiedReason(opts: { cannotBeShownCurrent: boolean }): string {
  return opts.cannotBeShownCurrent
    ? 'The price carries a verified stamp, but no check date is recorded, so the verification cannot be shown as current.'
    : 'The price carries a verified stamp, but no check date is recorded.';
}

/**
 * Never verified: "The <subject> was never <verb> by a real fetch[,
 * and its age is unknown — it must not be read as fresh]."
 *
 * - price-state.ts UNVERIFIED (fresh age): subject 'recorded price',
 *   verb 'checked', unknownAge false.
 * - price-state.ts UNVERIFIED (unknown age): subject 'recorded price',
 *   verb 'checked', unknownAge true.
 * - fully-verified.ts freshPrice fail (never verified): subject 'price',
 *   verb 'verified', unknownAge false.
 */
export function neverVerifiedReason(opts: {
  subject: 'recorded price' | 'price';
  verb: 'checked' | 'verified';
  unknownAge: boolean;
}): string {
  const base = `The ${opts.subject} was never ${opts.verb} by a real fetch`;
  return opts.unknownAge
    ? `${base}, and its age is unknown — it must not be read as fresh.`
    : `${base}.`;
}

/**
 * Stale recorded price, never verified (price-state.ts STALE only —
 * fully-verified.ts has no stale branch; it lives here so the
 * "older than N days" clause is shared, not restated):
 * "The recorded price was last checked <age> days ago — older than
 * <staleDays> days — and was never verified by a real fetch."
 * The caller appends its own source note after this string.
 */
export function staleNeverVerifiedReason(age: number, staleDays: number): string {
  return `The recorded price was last checked ${pluralDays(age)} ago — older than ${staleDays} days — and was never verified by a real fetch.`;
}
