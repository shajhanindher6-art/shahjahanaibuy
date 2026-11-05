/**
 * Geo deal rotation — homepage fatigue fix.
 *
 * PURE: no IO, no env, no dates read internally (the caller passes
 * the UTC day string), so it can be unit-tested directly.
 *
 * PROBLEM: the homepage widget shows the same ranked deals in the
 * same order to every visitor, every day — the same products lead
 * forever (repeating-product fatigue). There is no per-region deal
 * data to localise with: the deals table has no country/region
 * column, all six seed deals are Amazon/US demo deals, and
 * community_deals has no region column either. Inventing
 * per-region offers would violate the no-invented-data rule.
 *
 * SOLUTION: a deterministic CYCLIC ROTATION of the ranked list,
 * keyed by (visitor region, UTC day). The ranking is preserved —
 * the list is only rotated, so a different deal leads for each
 * region and each day, and no deal is added, removed, or re-ranked.
 * Same region + same day always gives the same order (stable
 * within a day, no flicker on re-renders); a different region or a
 * new day moves the starting point.
 *
 * The rotation is applied in the smart-deals route, AFTER the
 * (cached) ranking, so the ranking cache is unaffected.
 */

function hashString(input: string): number {
  // FNV-1a, 32-bit — small, deterministic, no dependency.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function rotateDealsForRegion<T>(
  items: T[],
  regionCode: string,
  utcDay: string
): T[] {
  if (items.length <= 1) return [...items];
  const offset =
    hashString(`${regionCode.toUpperCase()}|${utcDay}`) % items.length;
  if (offset === 0) return [...items];
  return [...items.slice(offset), ...items.slice(0, offset)];
}
