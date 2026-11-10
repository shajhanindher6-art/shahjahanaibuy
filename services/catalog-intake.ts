/**
 * Section 9 — Catalog intake pipeline (admin CSV upload → review → insert).
 *
 * Pure validation / planning logic: no DB access, no network, no live-price
 * fetching. The API route supplies the catalog context (existing slugs,
 * merchants, currencies) and is the only place that writes to the DB —
 * and only from `planIntakeInsert`, which is called on explicit approve.
 *
 * Provenance: `products` / `merchant_products` have NO `source` column
 * in the schema, so no column is invented here. Prices entered at intake
 * are recorded as manual prices: the UI labels them as such, and the
 * approve route stores `source: 'manual-intake'` in the
 * `admin_audit_logs.details` JSONB for the batch (see the route).
 * Nothing is ever guessed: a missing or invalid required field is a
 * per-row error, never a filled-in default.
 */

import { parseCsvDocument } from './providers/csv-provider';

/** Stored in the audit-log details for every approved intake batch. */
export const INTAKE_SOURCE = 'manual-intake';

export const INTAKE_REQUIRED_COLUMNS = [
  'name',
  'slug',
  'brand',
  'category',
  'price',
  'currency',
  'merchant',
] as const;

export const INTAKE_OPTIONAL_COLUMNS = ['description', 'image_url', 'image', 'gtin', 'sku'] as const;

/** A row the admin pasted/uploaded, keyed by lower-cased header name. */
export interface IntakeRowInput {
  rowNumber: number;
  name: string;
  slug: string;
  brand: string;
  category: string;
  price: string;
  currency: string;
  merchant: string;
  description?: string;
  imageUrl?: string;
  gtin?: string;
  sku?: string;
}

export interface IntakeRowError {
  /** 1-based CSV line number (header is line 1). */
  row: number;
  field: string;
  reason: string;
}

export type IntakeRowStatus = 'valid' | 'error' | 'duplicate' | 'near-duplicate';

export interface IntakeReviewedRow {
  rowNumber: number;
  status: IntakeRowStatus;
  /** Per-field validation failures (empty unless status is 'error'). */
  errors: IntakeRowError[];
  /** Slug of the existing product this row duplicates, if any. */
  duplicateOf?: string;
  /** Slug of the existing product with the same name + brand, if any. */
  nearDuplicateOf?: string;
  /** Validated, parsed values. Null unless the row is usable. */
  data: {
    name: string;
    slug: string;
    brand: string;
    category: string;
    price: number;
    currency: string;
    currencyId: string;
    merchant: string;
    merchantId: string;
    description?: string;
    imageUrl?: string;
    gtin?: string;
    sku?: string;
  } | null;
  /**
   * Admin's explicit per-row choice on a near-duplicate: include it in
   * the approve anyway. Only the admin UI sets this; duplicates and
   * error rows are never inserted regardless of this flag.
   */
  include?: boolean;
}

export interface IntakeReview {
  rows: IntakeReviewedRow[];
  summary: {
    total: number;
    valid: number;
    errors: number;
    duplicates: number;
    nearDuplicates: number;
  };
}

/** Live catalog data the route loads from Supabase for validation. */
export interface IntakeCatalogContext {
  /** Lower-cased slugs of products already in the catalog. */
  existingSlugs: Set<string>;
  /** Normalized `name|brand` key -> slug of the existing product. */
  existingNameBrands: Map<string, string>;
  /** Normalized merchant slug OR name -> merchant id. */
  knownMerchants: Map<string, string>;
  /** Upper-case currency code -> currency id. */
  knownCurrencies: Map<string, string>;
}

export interface IntakeInsertPlan {
  product: {
    name: string;
    slug: string;
    description?: string;
    brand: string;
    category: string;
    image_url?: string;
    gtin?: string;
  };
  merchantProduct: {
    merchantId: string;
    price: number;
    currencyId: string;
    merchantSku?: string;
  };
  /** The CSV line this insert came from, for the audit trail. */
  rowNumber: number;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Lower-case, collapse all non-alphanumerics to single spaces. */
export function normalizeIntakeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function intakeNameBrandKey(name: string, brand: string): string {
  return `${normalizeIntakeKey(name)}|${normalizeIntakeKey(brand)}`;
}

function getField(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value.trim() !== '') return value.trim();
  }
  return '';
}

/**
 * Parses intake CSV text into raw row inputs using the shared CSV parser
 * from `CsvProvider` (no second parser). Missing required header columns
 * are reported as header errors (row 1) instead of silently dropping
 * every row; rows with too few columns keep their missing fields empty
 * so validation reports them per row.
 */
export function parseIntakeCsv(csv: string): {
  rows: IntakeRowInput[];
  headerErrors: IntakeRowError[];
} {
  const headerErrors: IntakeRowError[] = [];
  const documentRows = parseCsvDocument(csv);

  if (documentRows.length === 0 && csv.trim() !== '') {
    // Header-only file, or a file whose only line is the header.
    const firstLine = csv.split(/\r?\n/)[0] ?? '';
    const headers = firstLine
      .split(',')
      .map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ''));
    for (const required of INTAKE_REQUIRED_COLUMNS) {
      if (!headers.includes(required)) {
        headerErrors.push({
          row: 1,
          field: required,
          reason: `Required column "${required}" is missing from the CSV header`,
        });
      }
    }
    return { rows: [], headerErrors };
  }

  if (documentRows.length === 0) {
    return { rows: [], headerErrors };
  }

  // Header check from the first parsed row's keys.
  const headerKeys = Object.keys(documentRows[0].row);
  for (const required of INTAKE_REQUIRED_COLUMNS) {
    if (!headerKeys.includes(required)) {
      headerErrors.push({
        row: 1,
        field: required,
        reason: `Required column "${required}" is missing from the CSV header`,
      });
    }
  }

  const rows: IntakeRowInput[] = documentRows.map(({ rowNumber, row }) => ({
    rowNumber,
    name: getField(row, ['name']),
    slug: getField(row, ['slug']),
    brand: getField(row, ['brand']),
    category: getField(row, ['category']),
    price: getField(row, ['price']),
    currency: getField(row, ['currency']),
    merchant: getField(row, ['merchant']),
    description: getField(row, ['description']) || undefined,
    imageUrl: getField(row, ['image_url', 'image']) || undefined,
    gtin: getField(row, ['gtin']) || undefined,
    sku: getField(row, ['sku']) || undefined,
  }));

  return { rows, headerErrors };
}

/**
 * Validates parsed intake rows against the live catalog context.
 * Pure function — it reads nothing and writes nothing, so the preview
 * step can never insert anything.
 *
 * Per row, in order:
 *  1. required-field / format errors (one error per bad field),
 *  2. slug already in the catalog, or repeated in this file → 'duplicate',
 *  3. same normalized name + brand already in the catalog, or repeated
 *     in this file → 'near-duplicate' (flagged for review, not inserted
 *     unless the admin explicitly includes the row at approve time),
 *  4. otherwise 'valid'.
 */
export function reviewIntakeRows(
  rows: IntakeRowInput[],
  context: IntakeCatalogContext,
): IntakeReview {
  const seenSlugs = new Set<string>();
  const seenNameBrands = new Map<string, number>();
  const reviewed: IntakeReviewedRow[] = [];

  for (const input of rows) {
    const errors: IntakeRowError[] = [];
    const row = input.rowNumber;

    if (!input.name) {
      errors.push({ row, field: 'name', reason: 'Name is required' });
    }
    if (!input.slug) {
      errors.push({ row, field: 'slug', reason: 'Slug is required' });
    } else if (!SLUG_PATTERN.test(input.slug.toLowerCase())) {
      errors.push({
        row,
        field: 'slug',
        reason: 'Slug must be lowercase letters, numbers and hyphens only (e.g. "macbook-air-13")',
      });
    }
    if (!input.brand) {
      errors.push({ row, field: 'brand', reason: 'Brand is required' });
    }
    if (!input.category) {
      errors.push({ row, field: 'category', reason: 'Category is required' });
    }

    let price: number | null = null;
    if (!input.price) {
      errors.push({ row, field: 'price', reason: 'Price is required' });
    } else {
      const parsed = Number(input.price.replace(/[^0-9.,-]/g, '').replace(',', '.'));
      if (!Number.isFinite(parsed)) {
        errors.push({ row, field: 'price', reason: `Price "${input.price}" is not a number` });
      } else if (parsed <= 0) {
        errors.push({ row, field: 'price', reason: 'Price must be greater than 0' });
      } else {
        price = parsed;
      }
    }

    let currencyId: string | null = null;
    if (!input.currency) {
      errors.push({ row, field: 'currency', reason: 'Currency is required' });
    } else if (!/^[A-Za-z]{3}$/.test(input.currency.trim())) {
      errors.push({
        row,
        field: 'currency',
        reason: `Currency "${input.currency}" must be a 3-letter code (e.g. USD)`,
      });
    } else {
      currencyId = context.knownCurrencies.get(input.currency.trim().toUpperCase()) ?? null;
      if (!currencyId) {
        errors.push({
          row,
          field: 'currency',
          reason: `Unknown currency code "${input.currency.toUpperCase()}" — no matching currency exists`,
        });
      }
    }

    let merchantId: string | null = null;
    if (!input.merchant) {
      errors.push({ row, field: 'merchant', reason: 'Merchant is required' });
    } else {
      merchantId =
        context.knownMerchants.get(normalizeIntakeKey(input.merchant)) ?? null;
      if (!merchantId) {
        errors.push({
          row,
          field: 'merchant',
          reason: `Unknown merchant "${input.merchant}" — merchants are never auto-created; add the merchant first`,
        });
      }
    }

    const slug = input.slug.toLowerCase();
    const nameBrandKey =
      input.name && input.brand ? intakeNameBrandKey(input.name, input.brand) : '';

    let status: IntakeRowStatus;
    let duplicateOf: string | undefined;
    let nearDuplicateOf: string | undefined;

    if (errors.length > 0) {
      status = 'error';
    } else if (context.existingSlugs.has(slug) || seenSlugs.has(slug)) {
      status = 'duplicate';
      duplicateOf = context.existingSlugs.has(slug) ? slug : slug;
    } else if (nameBrandKey) {
      const existing = context.existingNameBrands.get(nameBrandKey);
      const seenInFile = seenNameBrands.get(nameBrandKey);
      if (existing) {
        status = 'near-duplicate';
        nearDuplicateOf = existing;
      } else if (seenInFile !== undefined && seenInFile !== row) {
        status = 'near-duplicate';
        nearDuplicateOf = `row ${seenInFile} in this file`;
      } else {
        status = 'valid';
      }
    } else {
      status = 'valid';
    }

    if (status === 'valid' || status === 'near-duplicate') {
      seenSlugs.add(slug);
      if (nameBrandKey && !seenNameBrands.has(nameBrandKey)) {
        seenNameBrands.set(nameBrandKey, row);
      }
    }

    reviewed.push({
      rowNumber: row,
      status,
      errors,
      ...(duplicateOf ? { duplicateOf } : {}),
      ...(nearDuplicateOf ? { nearDuplicateOf } : {}),
      data:
        status === 'valid' || status === 'near-duplicate'
          ? {
              name: input.name,
              slug,
              brand: input.brand,
              category: input.category,
              price: price as number,
              currency: input.currency.trim().toUpperCase(),
              currencyId: currencyId as string,
              merchant: input.merchant,
              merchantId: merchantId as string,
              ...(input.description ? { description: input.description } : {}),
              ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
              ...(input.gtin ? { gtin: input.gtin } : {}),
              ...(input.sku ? { sku: input.sku } : {}),
            }
          : null,
    });
  }

  return {
    rows: reviewed,
    summary: {
      total: reviewed.length,
      valid: reviewed.filter((r) => r.status === 'valid').length,
      errors: reviewed.filter((r) => r.status === 'error').length,
      duplicates: reviewed.filter((r) => r.status === 'duplicate').length,
      nearDuplicates: reviewed.filter((r) => r.status === 'near-duplicate').length,
    },
  };
}

/**
 * Builds the DB insert payloads for an approved batch. This is the ONLY
 * function that produces anything insertable, and the route calls it
 * only from the explicit approve action — preview never calls it, so
 * nothing can be inserted before approve.
 *
 * Included: rows with status 'valid', plus 'near-duplicate' rows the
 * admin explicitly flagged `include: true` for this approve.
 * Never included: 'error' rows, 'duplicate' rows (slug already exists),
 * and 'near-duplicate' rows without an explicit include.
 */
export function planIntakeInsert(reviewedRows: IntakeReviewedRow[]): IntakeInsertPlan[] {
  const plans: IntakeInsertPlan[] = [];

  for (const reviewed of reviewedRows) {
    if (!reviewed.data) continue;
    if (reviewed.status === 'valid') {
      // fall through — insert
    } else if (reviewed.status === 'near-duplicate' && reviewed.include === true) {
      // fall through — admin explicitly reviewed and included this row
    } else {
      continue;
    }

    const d = reviewed.data;
    plans.push({
      rowNumber: reviewed.rowNumber,
      product: {
        name: d.name,
        slug: d.slug,
        brand: d.brand,
        category: d.category,
        ...(d.description ? { description: d.description } : {}),
        ...(d.imageUrl ? { image_url: d.imageUrl } : {}),
        ...(d.gtin ? { gtin: d.gtin } : {}),
      },
      merchantProduct: {
        merchantId: d.merchantId,
        price: d.price,
        currencyId: d.currencyId,
        ...(d.sku ? { merchantSku: d.sku } : {}),
      },
    });
  }

  return plans;
}
