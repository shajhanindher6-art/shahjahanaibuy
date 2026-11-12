/**
 * Cheapest Store by Category — pure helpers for
 * /tools/cheapest-store-by-category (Section 16, E11 / item 29).
 *
 * Table of which store has the lowest recorded price per category.
 *
 * Honesty rules:
 * - Only Amazon + Best Buy carry priced rows (merchant_products),
 *   so the table is honestly a two-store comparison — the page
 *   says so, and a category with a price at only one store shows
 *   "No recorded price" for the other, never a guessed price.
 * - "Lowest" is the lowest recorded in-stock merchant price for
 *   any product in the category, with the product named — a
 *   category low is meaningless without the product behind it.
 * - Categories with no priced product at any store are omitted
 *   from the table and listed separately as having no recorded
 *   prices.
 */

export interface CheapestStoreRowInput {
  category: string | null;
  merchantName: string;
  price: number;
  inStock: boolean;
  productName: string;
  productSlug: string;
}

export interface CheapestStoreEntry {
  merchantName: string;
  price: number;
  productName: string;
  productSlug: string;
}

export interface CheapestCategoryRow {
  category: string;
  /** Lowest recorded price per merchant that has one in this category. */
  byMerchant: CheapestStoreEntry[];
  /** The overall cheapest entry, or null when no merchant has a price. */
  cheapest: CheapestStoreEntry | null;
}

export interface CheapestStoreTable {
  rows: CheapestCategoryRow[];
  merchants: string[];
  categoriesWithNoPrices: string[];
}

/**
 * Build the per-category cheapest-store table from recorded
 * merchant listings. Only in-stock rows with a finite positive
 * price count; unpriced / out-of-stock rows are ignored, never
 * treated as zero.
 */
export function buildCheapestStoreTable(
  listings: CheapestStoreRowInput[],
  allCategories: string[] = []
): CheapestStoreTable {
  const byCategory = new Map<string, Map<string, CheapestStoreEntry>>();
  const merchants = new Set<string>();

  for (const l of listings) {
    if (!l.category || l.category.trim().length === 0) continue;
    if (!l.inStock) continue;
    if (!Number.isFinite(l.price) || l.price <= 0) continue;
    const category = l.category.trim();
    merchants.add(l.merchantName);
    let perMerchant = byCategory.get(category);
    if (!perMerchant) {
      perMerchant = new Map();
      byCategory.set(category, perMerchant);
    }
    const current = perMerchant.get(l.merchantName);
    if (!current || l.price < current.price) {
      perMerchant.set(l.merchantName, {
        merchantName: l.merchantName,
        price: l.price,
        productName: l.productName,
        productSlug: l.productSlug,
      });
    }
  }

  const rows: CheapestCategoryRow[] = Array.from(byCategory, ([category, perMerchant]) => {
    const byMerchant = Array.from(perMerchant.values()).sort((a, b) => a.price - b.price);
    return {
      category,
      byMerchant,
      cheapest: byMerchant.length > 0 ? byMerchant[0] : null,
    };
  }).sort((a, b) => a.category.localeCompare(b.category));

  const pricedCategories = new Set(rows.map((r) => r.category));
  const categoriesWithNoPrices = allCategories
    .filter((c) => c.trim().length > 0 && !pricedCategories.has(c.trim()))
    .sort();

  return {
    rows,
    merchants: Array.from(merchants).sort(),
    categoriesWithNoPrices,
  };
}
