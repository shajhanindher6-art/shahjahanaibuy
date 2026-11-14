/**
 * Saved-calculation share links (Section 16, #36) — client-safe
 * pure helpers, no Supabase, no network.
 *
 * A pure-local tool's calculation IS its input params: the tool
 * pages are GET forms, so the result URL already carries the
 * inputs (?price=…&rate=…&months=…). A shareable link is that
 * URL, built from the params object — opening it re-runs the same
 * calculation on the tool page. A saved calculation (server row,
 * migration 043) stores the same params; re-opening it is a link
 * back to /tools/<tool>?<params>.
 */

export type CalculationParams = Record<string, string | number | boolean>;

/**
 * The 12 pure client-side calculator tools (0 fetch() calls each)
 * plus the 8 new tools whose result replays from the URL
 * (Master Tool Integration, Stage 3, S3-3): upgrade-advisor,
 * persona-fit, own-it-check, energy-cost, negotiation-coach,
 * deal-stacker, refurbished-checklist, compatibility-checker.
 * price-match (a filter-only directory) and repairability (no
 * params at all) have no calculable result to re-open, so they
 * are NOT in this list — buildSavedCalculationUrl falls back to
 * their bare tool route for them.
 */
export const SAVED_CALCULATION_TOOLS = [
  'emi-calculator',
  'landed-cost',
  'gift-splitter',
  'currency-converter',
  'budget-finder',
  'forecast-explainer',
  'future-you-planner',
  'monthly-planner',
  'expense-tracker',
  'subscription-manager',
  'savings-dashboard',
  'list-optimizer',
  // Stage 3, S3-3 — new tools with replayable results (see above).
  'upgrade-advisor',
  'persona-fit',
  'own-it-check',
  'energy-cost',
  'negotiation-coach',
  'deal-stacker',
  'refurbished-checklist',
  'compatibility-checker',
] as const;

export type SavedCalculationTool = (typeof SAVED_CALCULATION_TOOLS)[number];

export function isSavedCalculationTool(tool: string): tool is SavedCalculationTool {
  return (SAVED_CALCULATION_TOOLS as readonly string[]).includes(tool);
}

/**
 * Build the shareable URL for a calculation: /tools/<tool> with
 * the input params as the query string. Params are sorted by key
 * so the same calculation always produces the same link.
 * Returns null when the tool is unknown or there are no params.
 */
export function buildCalculationShareUrl(
  tool: string,
  params: CalculationParams,
  baseUrl?: string
): string | null {
  if (!isSavedCalculationTool(tool)) return null;
  const entries = Object.entries(params).filter(
    ([, v]) => v !== '' && v !== null && v !== undefined
  );
  if (entries.length === 0) return null;
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = new URLSearchParams(
    entries.map(([k, v]) => [k, String(v)])
  ).toString();
  const path = `/tools/${tool}?${query}`;
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

/**
 * Parse a tool page's query string back into calculation params
 * (the inverse of buildCalculationShareUrl). Only string values
 * come back — the tool's own parser validates them.
 */
export function parseCalculationShareParams(query: string): CalculationParams {
  const params: CalculationParams = {};
  for (const [key, value] of new URLSearchParams(query)) {
    if (key && value !== '') params[key] = value;
  }
  return params;
}
