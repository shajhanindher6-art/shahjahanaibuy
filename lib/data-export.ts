/**
 * User data export (Section 14, Chunk 7) — pure serializer.
 *
 * GET /api/v1/data/export returns exactly this document: the
 * signed-in user's own data only (wishlists + items, price alerts,
 * buy list, savings ledger, recent searches, referral link). Every
 * section is an array that is empty when the user has no rows or
 * the table is not set up yet — the export never invents rows and
 * never fails the whole document because one table is missing.
 * No secrets are ever included: no password hashes, no API keys,
 * no push subscription endpoints, no tokens.
 */

export interface ExportSection<T> {
  count: number;
  rows: T[];
}

export interface UserDataExport {
  format: 'smartbuy-user-data-export';
  version: 1;
  exportedAt: string;
  userId: string;
  sections: {
    profile: ExportSection<Record<string, unknown>>;
    wishlists: ExportSection<Record<string, unknown>>;
    wishlistItems: ExportSection<Record<string, unknown>>;
    alerts: ExportSection<Record<string, unknown>>;
    buyList: ExportSection<Record<string, unknown>>;
    savings: ExportSection<Record<string, unknown>>;
    searchHistory: ExportSection<Record<string, unknown>>;
    referralLinks: ExportSection<Record<string, unknown>>;
    /**
     * Section 19, Phase 4 (§12 #44) — the two recommendation
     * signals the export used to miss: every product the user
     * viewed (product_views, migration 008) and their preference
     * row (user_preferences, migration 008 — budgets, favourite
     * brands/categories/retailers, notification flags). No secrets
     * in either section: views carry no content, preferences carry
     * no credentials.
     */
    productViews: ExportSection<Record<string, unknown>>;
    userPreferences: ExportSection<Record<string, unknown>>;
  };
}

export function emptyExportSection<T>(): ExportSection<T> {
  return { count: 0, rows: [] };
}

export function buildExportSection<T>(rows: T[] | null | undefined): ExportSection<T> {
  const list = Array.isArray(rows) ? rows : [];
  return { count: list.length, rows: list };
}

/** Total rows across every section — the one number the UI shows. */
export function exportTotalRows(doc: UserDataExport): number {
  return Object.values(doc.sections).reduce((sum, s) => sum + s.count, 0);
}

/** Section names that actually contain rows (for the summary line). */
export function exportNonEmptySections(doc: UserDataExport): string[] {
  return (Object.keys(doc.sections) as Array<keyof UserDataExport['sections']>).filter(
    (key) => doc.sections[key].count > 0
  );
}

export function buildExportDocument(
  userId: string,
  sections: UserDataExport['sections'],
  exportedAt: Date = new Date()
): UserDataExport {
  return {
    format: 'smartbuy-user-data-export',
    version: 1,
    exportedAt: exportedAt.toISOString(),
    userId,
    sections,
  };
}

/** File name for the download — dated, so repeated exports never clash. */
export function exportFileName(exportedAt: Date = new Date()): string {
  return `smartbuy-data-export-${exportedAt.toISOString().slice(0, 10)}.json`;
}
