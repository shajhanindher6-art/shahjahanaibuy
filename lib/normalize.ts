/**
 * Shared text normalization (Master Tool Integration, S2-6).
 *
 * CANONICAL HOME of `normalizeDedupeText` — the one text normalizer
 * for dedupe / matching comparisons across the repo. It lower-cases
 * and collapses every run of non-alphanumerics to a single space, so
 * "MacBook Air 13-inch", "macbook air 13 inch" and "  MacBook   Air
 * 13-inch " all normalize to "macbook air 13 inch".
 *
 * HISTORY: this function used to live in
 * services/pipeline/deduplication.ts, with a byte-identical private
 * copy (`normalizeOwnItText`) in lib/own-it-check.ts and inline
 * `toLowerCase().trim()` sites in services/guided-finder.ts. It moved
 * here because lib/own-it-check.ts must stay dependency-free and
 * usable from the client guest-check leaf — it cannot import from
 * services/ — so the shared home has to be a pure lib module with no
 * server imports. services/pipeline/deduplication.ts re-exports it,
 * so existing importers keep working unchanged.
 *
 * RULE: any comparison that needs "same text, different punctuation
 * or case" must call this — never a local toLowerCase().trim() or a
 * private copy. When comparing two values, normalize BOTH sides:
 * normalizing only the query side while the stored side stays raw
 * silently breaks matches on punctuated values.
 */

/** Lower-case, collapse all non-alphanumerics to single spaces. */
export function normalizeDedupeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
