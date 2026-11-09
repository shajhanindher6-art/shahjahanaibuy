/**
 * Hidden Costs & Total Ownership Calculator — pure math.
 *
 * Deterministic, no LLM, no fetch, no scraping, no scheduler. The
 * total is the product's REAL recorded base price (lowest merchant
 * price, supplied by the caller) plus three amounts the SHOPPER
 * enters themselves — accessories, protection-plan / warranty, and
 * maintenance budget. There are no default costs anywhere: every
 * extra defaults to 0 and is only ever what the user typed.
 *
 * HONESTY RULES (do not weaken them):
 * - Never invent a cost. Accessories / warranty / maintenance are
 *   user-entered estimates, and the UI must label them as such.
 * - The result is a budget-planning total, never a retailer's
 *   checkout total and never a quote.
 * - Sanitization: any non-finite or negative input is treated as 0
 *   (documented, never silently clamped to a guessed value).
 */

export interface OwnershipInputs {
  /** Real recorded base price in USD (lowest merchant price). */
  basePriceUsd: number;
  /** User-entered accessories budget in USD (0 when unknown). */
  accessoriesUsd: number;
  /** User-entered protection-plan / warranty budget in USD. */
  warrantyUsd: number;
  /** User-entered maintenance budget in USD. */
  maintenanceUsd: number;
}

export interface OwnershipResult {
  basePriceUsd: number;
  accessoriesUsd: number;
  warrantyUsd: number;
  maintenanceUsd: number;
  /** accessories + warranty + maintenance, after sanitization. */
  extrasUsd: number;
  /** base + extras, after sanitization. */
  totalUsd: number;
  /** Whole percent of the total that the extras make up (0 when total is 0). */
  extrasSharePct: number;
}

/** localStorage key for one product's saved ownership inputs. */
export function ownershipStorageKey(slug: string): string {
  return `sb-ownership-${slug}`;
}

function sanitizeAmount(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Total cost of ownership from a real base price plus the shopper's
 * own extra budgets. total = base + accessories + warranty +
 * maintenance; extrasSharePct = round(100 * extras / total), or 0
 * when the total is 0. Non-finite or negative inputs count as 0.
 */
export function computeTotalOwnership(
  inputs: OwnershipInputs
): OwnershipResult {
  const basePriceUsd = sanitizeAmount(inputs.basePriceUsd);
  const accessoriesUsd = sanitizeAmount(inputs.accessoriesUsd);
  const warrantyUsd = sanitizeAmount(inputs.warrantyUsd);
  const maintenanceUsd = sanitizeAmount(inputs.maintenanceUsd);
  const extrasUsd = accessoriesUsd + warrantyUsd + maintenanceUsd;
  const totalUsd = basePriceUsd + extrasUsd;
  const extrasSharePct =
    totalUsd > 0 ? Math.round((100 * extrasUsd) / totalUsd) : 0;
  return {
    basePriceUsd,
    accessoriesUsd,
    warrantyUsd,
    maintenanceUsd,
    extrasUsd,
    totalUsd,
    extrasSharePct,
  };
}
