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
import { validateGtin } from '@/lib/gtin';
import { validateImageUrl } from '@/lib/image-url';
import { validateModelNumber } from '@/lib/model-identity';
import { validateSpecEntries, type SpecEntryInput } from '@/lib/spec-templates';
import {
  validateProductVariant,
  type ProductVariantInput,
} from '@/services/pipeline/variants';
import { nearMissSimilarity, NEAR_MISS_THRESHOLD } from '@/lib/fuzzy-match';
import { modelsConflict, normalizeBrand, normalizeModel } from '@/lib/model-normalization';

/** Stored in the audit-log details for every approved intake batch. */
export { INTAKE_SOURCE } from '@/lib/intake-sources';

export const INTAKE_REQUIRED_COLUMNS = [
  'name',
  'slug',
  'brand',
  'category',
  'price',
  'currency',
  'merchant',
] as const;

export const INTAKE_OPTIONAL_COLUMNS = [
  'description',
  'image_url',
  'image',
  // FINAL 100%, F-P2-34 — extra gallery images, ';'-separated URLs.
  'image_urls',
  'gtin',
  'sku',
  'model_number',
  // FINAL 100%, F-P1-22 — specs column (see parseSpecColumn).
  'specs',
  // FINAL 100%, F-P2-09 — variants column (see parseVariantColumn).
  'variants',
] as const;

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
  /**
   * Section 20, #6: manufacturer model number, recorded verbatim
   * from the CSV `model_number` column. Optional — 0/10 live
   * products have one, and a missing value is an honest empty
   * state, never a guessed value.
   */
  modelNumber?: string;
  /**
   * FINAL 100%, F-P1-22 — specs parsed from the CSV `specs`
   * column (`ram: 16 GB; storage: 512 GB`). Validated against
   * the category template in reviewIntakeRows; never invented.
   */
  specs?: SpecEntryInput[];
  /** Parse errors from the `specs` column (empty when it parsed). */
  specParseErrors?: string[];
  /**
   * FINAL 100%, F-P2-09 — variants parsed from the CSV
   * `variants` column (JSON array, or `name~sku~gtin~key=value`
   * segments separated by `;;`). Validated in reviewIntakeRows.
   */
  variants?: ProductVariantInput[];
  /** Parse errors from the `variants` column. */
  variantParseErrors?: string[];
  /**
   * FINAL 100%, F-P2-34 — extra gallery image URLs from the
   * CSV `image_urls` column (';'-separated). Each is validated
   * like imageUrl; approve writes them as product_images rows.
   */
  imageUrls?: string[];
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
  /**
   * Section 20, #9: plain-language reason when the row was held
   * as a near-duplicate for a reason other than name + brand —
   * e.g. the same GTIN already exists under a different slug.
   * The admin UI shows this verbatim so the reviewer knows what
   * to check before ticking "Include anyway".
   */
  duplicateDetail?: string;
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
    modelNumber?: string;
    specs?: SpecEntryInput[];
    variants?: ProductVariantInput[];
    imageUrls?: string[];
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
  /**
   * Section 20, #9: normalized GTIN -> slug of the existing
   * product carrying it. Optional so contexts built by older
   * callers/tests (which predate the field) keep working — a
   * missing map simply means "no GTIN check available", and the
   * review treats it as empty. loadCatalogContext always fills
   * it from the live catalog.
   */
  existingGtins?: Map<string, string>;
  /**
   * FINAL 100% (F-P1-45/F-P1-46): normalized model + normalized
   * brand -> slug of the existing product carrying it. The key
   * is `${normalizeModel(model)}|${normalizeBrand(brand)}`, so
   * "SM-S928B" variants match each other. Optional like
   * existingGtins — a missing map means "no model check
   * available". loadCatalogContext fills it best-effort (the
   * model_number column exists only after migration 055).
   */
  existingModels?: Map<string, string>;
  /**
   * FINAL 100% (F-P1-45): slug -> the existing product's
   * normalized model number (or null when it has none). Lets the
   * fuzzy leg veto a hold when the models conflict: similar
   * names for different models are different products, not a
   * near-duplicate.
   */
  existingModelsBySlug?: Map<string, string | null>;
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
    model_number?: string;
  };
  merchantProduct: {
    merchantId: string;
    price: number;
    currencyId: string;
    merchantSku?: string;
  };
  /** Validated spec entries from the CSV `specs` column (F-P1-22). */
  specs?: SpecEntryInput[];
  /** Validated variants from the CSV `variants` column (F-P2-09). */
  variants?: ProductVariantInput[];
  /** Gallery URLs: image_url first, then image_urls (F-P2-34). */
  galleryUrls?: string[];
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

/**
 * Section 21–25, Stage C (B3) — fuzzy name+brand match over
 * normalized "name|brand" keys (the shape `existingNameBrands`
 * already stores, so no new catalog context is needed).
 *
 * The pipeline dedups with token-Jaccard ≥ 0.75; CSV review did
 * not, so "MacBook Air 13-inch" vs "MacBook Air 13" (same brand)
 * sailed through as 'valid' and could create a second catalog
 * row. The fuzzy leg requires the SAME normalized brand AND a
 * name similarity ≥ 0.75 (token Jaccard or bigram Dice —
 * lib/fuzzy-match.ts, the same 0.75 bar as the pipeline). A
 * different brand never fuzzy-matches, however similar the name:
 * "MacBook Air 13" (Apple) vs "MacBook Air 13" (a clone brand)
 * is a different product, not a duplicate.
 *
 * Returns the matched key, or null. Pure.
 */
export function findFuzzyNameBrandKey(
  name: string,
  brand: string,
  keys: Iterable<string>
): string | null {
  const wantedName = normalizeIntakeKey(name);
  const wantedBrand = normalizeIntakeKey(brand);
  if (!wantedName || !wantedBrand) return null;
  let best: { key: string; similarity: number } | null = null;
  for (const key of keys) {
    const separator = key.indexOf('|');
    if (separator < 0) continue;
    const keyName = key.slice(0, separator);
    const keyBrand = key.slice(separator + 1);
    if (keyBrand !== wantedBrand) continue;
    const similarity = nearMissSimilarity(wantedName, keyName);
    if (similarity >= NEAR_MISS_THRESHOLD && (!best || similarity > best.similarity)) {
      best = { key, similarity };
    }
  }
  return best?.key ?? null;
}

/**
 * Section 20, #9 — GTIN normalization for dedupe: strip spaces
 * and hyphens, upper-case. "978-0-123" and "9780123" are the same
 * GTIN; without this, the same product under a different slug
 * would pass intake as 'valid' on a formatting difference alone.
 */
export function normalizeGtin(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function getField(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value.trim() !== '') return value.trim();
  }
  return '';
}

/**
 * FINAL 100%, F-P1-22 — parse the CSV `specs` column.
 * Format: `ram: 16 GB; storage: 512 GB` — semicolon-separated
 * `key: value` pairs. The key must match a template key for the
 * product's category (checked later, in reviewIntakeRows); this
 * step only parses the shape. A segment without a colon is a
 * parse error, never silently dropped. No value is ever invented.
 */
export function parseSpecColumn(raw: string): {
  specs: SpecEntryInput[];
  errors: string[];
} {
  const specs: SpecEntryInput[] = [];
  const errors: string[] = [];
  for (const segment of raw.split(';')) {
    const part = segment.trim();
    if (!part) continue;
    const colon = part.indexOf(':');
    if (colon < 0) {
      errors.push(`Spec "${part}" has no ":" — use "key: value" (e.g. "ram: 16 GB")`);
      continue;
    }
    const key = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).trim();
    if (!key) {
      errors.push(`Spec "${part}" has an empty key`);
      continue;
    }
    if (!value) {
      errors.push(`Spec "${key}" has an empty value`);
      continue;
    }
    specs.push({ key, value });
  }
  return { specs, errors };
}

/**
 * FINAL 100%, F-P2-09 — parse the CSV `variants` column.
 * Two shapes: a JSON array (`[{"name":"16 GB / 512 GB","sku":"X",
 * "gtin":"...","attributes":{"ram":"16 GB"}}]`) or the compact
 * form — variants separated by `;;`, each
 * `name~sku~gtin~key=value,key=value` (empty segments allowed).
 * A variant without a name, or with a malformed segment, is a
 * parse error, never silently dropped. GTINs are GS1-validated
 * later, in reviewIntakeRows.
 */
export function parseVariantColumn(raw: string): {
  variants: ProductVariantInput[];
  errors: string[];
} {
  const trimmed = raw.trim();
  if (!trimmed) return { variants: [], errors: [] };
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) {
        return { variants: [], errors: ['Variants JSON must be an array'] };
      }
      const variants: ProductVariantInput[] = [];
      const errors: string[] = [];
      for (const item of parsed as Array<Record<string, unknown>>) {
        if (typeof item !== 'object' || item === null || typeof item.name !== 'string') {
          errors.push('Each variant must be an object with a "name"');
          continue;
        }
        variants.push({
          name: item.name,
          ...(typeof item.sku === 'string' ? { sku: item.sku } : {}),
          ...(typeof item.gtin === 'string' ? { gtin: item.gtin } : {}),
          ...(typeof item.imageUrl === 'string' ? { imageUrl: item.imageUrl } : {}),
          ...(item.attributes && typeof item.attributes === 'object'
            ? { attributes: item.attributes as Record<string, string> }
            : {}),
        });
      }
      return { variants, errors };
    } catch {
      return { variants: [], errors: ['Variants column is not valid JSON'] };
    }
  }
  const variants: ProductVariantInput[] = [];
  const errors: string[] = [];
  for (const segment of trimmed.split(';;')) {
    const part = segment.trim();
    if (!part) continue;
    const fields = part.split('~').map((f) => f.trim());
    const [name = '', sku = '', gtin = '', attrsRaw = ''] = fields;
    if (fields.length > 4) {
      errors.push(`Variant "${part}" has too many "~" segments (expected name~sku~gtin~key=value)`);
      continue;
    }
    if (!name) {
      errors.push(`Variant "${part}" has no name`);
      continue;
    }
    const attributes: Record<string, string> = {};
    if (attrsRaw) {
      for (const pair of attrsRaw.split(',')) {
        const eq = pair.indexOf('=');
        if (eq < 0) {
          errors.push(`Variant "${name}" attribute "${pair.trim()}" has no "=" — use "key=value"`);
          continue;
        }
        const k = pair.slice(0, eq).trim();
        const v = pair.slice(eq + 1).trim();
        if (k && v) attributes[k] = v;
      }
    }
    variants.push({
      name,
      ...(sku ? { sku } : {}),
      ...(gtin ? { gtin } : {}),
      ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
    });
  }
  return { variants, errors };
}

/** Parse the CSV `image_urls` column: ';'-separated URLs. */
export function parseImageUrlsColumn(raw: string): string[] {
  return raw
    .split(';')
    .map((u) => u.trim())
    .filter((u) => u.length > 0);
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

  const rows: IntakeRowInput[] = documentRows.map(({ rowNumber, row }) => {
    const specsRaw = getField(row, ['specs']);
    const parsedSpecs = specsRaw ? parseSpecColumn(specsRaw) : { specs: [], errors: [] };
    const variantsRaw = getField(row, ['variants']);
    const parsedVariants = variantsRaw
      ? parseVariantColumn(variantsRaw)
      : { variants: [], errors: [] };
    const imageUrlsRaw = getField(row, ['image_urls']);
    return {
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
      modelNumber: getField(row, ['model_number']) || undefined,
      specs: parsedSpecs.specs.length > 0 ? parsedSpecs.specs : undefined,
      specParseErrors: parsedSpecs.errors.length > 0 ? parsedSpecs.errors : undefined,
      variants: parsedVariants.variants.length > 0 ? parsedVariants.variants : undefined,
      variantParseErrors: parsedVariants.errors.length > 0 ? parsedVariants.errors : undefined,
      imageUrls: imageUrlsRaw ? parseImageUrlsColumn(imageUrlsRaw) : undefined,
    };
  });

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
 *  3. same GTIN already in the catalog under a different slug, or
 *     repeated in this file → 'near-duplicate' (Section 20, #9:
 *     held for manual review, never silently inserted),
 *  4. same normalized name + brand already in the catalog, or repeated
 *     in this file → 'near-duplicate' (flagged for review, not inserted
 *     unless the admin explicitly includes the row at approve time),
 *  4b. same normalized brand + a SIMILAR name (similarity ≥ 0.75) already
 *     in the catalog, or repeated in this file → 'near-duplicate'
 *     (Section 21–25, Stage C, B3 — the fuzzy leg the pipeline has
 *     and CSV review did not; a reworded name is held for review,
 *     never silently inserted),
 *  5. otherwise 'valid'.
 */
export function reviewIntakeRows(
  rows: IntakeRowInput[],
  context: IntakeCatalogContext,
): IntakeReview {
  const seenSlugs = new Set<string>();
  const seenNameBrands = new Map<string, number>();
  // Section 20, #9: normalized GTIN -> first row number carrying it.
  const seenGtins = new Map<string, number>();
  // FINAL 100% (F-P1-45): normalized `model|brand` key -> first
  // row number carrying it, plus row -> normalized model (for the
  // fuzzy-leg model-conflict veto below).
  const seenModels = new Map<string, number>();
  const seenRowModels = new Map<number, string | null>();
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

    // Section 20, §12 #31 / #94 — review-time validation for the
    // two optional fields that used to pass through untouched:
    // a present GTIN must be a GS1-valid GTIN (check digit), and
    // a present image URL must be a valid http(s) URL (no data: /
    // javascript:, length cap, host sanity). Either failure is a
    // per-row error, never a silently dropped or rewritten value.
    // eBay intake shares this review (services/ebay-intake.ts),
    // so the same gate applies to eBay listings.
    let normalizedGtin: string | undefined;
    if (input.gtin) {
      const gtinCheck = validateGtin(input.gtin);
      if (!gtinCheck.valid) {
        errors.push({
          row,
          field: 'gtin',
          reason: gtinCheck.reason ?? 'Invalid GTIN',
        });
      } else {
        normalizedGtin = gtinCheck.normalized ?? undefined;
      }
    }
    let normalizedImageUrl: string | undefined;
    if (input.imageUrl) {
      const imageCheck = validateImageUrl(input.imageUrl);
      if (!imageCheck.valid) {
        errors.push({
          row,
          field: 'image_url',
          reason: imageCheck.reason ?? 'Invalid image URL',
        });
      } else {
        normalizedImageUrl = imageCheck.normalized ?? undefined;
      }
    }
    // FINAL 100%, F-P2-34 — every extra gallery URL is validated
    // like image_url; a bad one is a per-row error, never stored.
    const normalizedImageUrls: string[] = [];
    for (const extraUrl of input.imageUrls ?? []) {
      const check = validateImageUrl(extraUrl);
      if (!check.valid) {
        errors.push({
          row,
          field: 'image_urls',
          reason: `Image URL "${extraUrl}": ${check.reason ?? 'Invalid image URL'}`,
        });
      } else if (check.normalized) {
        normalizedImageUrls.push(check.normalized);
      }
    }
    // FINAL 100%, F-P1-07 (code half) — a present model number
    // must be a real model number (digit-bearing, sane chars).
    // A family word ("X1" with no digit is fine as a NAME, but
    // as a model_number it is rejected — it would pin nothing).
    // Missing is fine: honest empty, never guessed.
    if (input.modelNumber) {
      const modelCheck = validateModelNumber(input.modelNumber);
      if (!modelCheck.valid) {
        errors.push({
          row,
          field: 'model_number',
          reason: modelCheck.reason ?? 'Invalid model number',
        });
      }
    }
    // FINAL 100%, F-P1-22 (code half) — CSV specs are validated
    // against the category template, with attribution + rejection
    // reasons. A spec parse failure, an unknown key, or an empty
    // value is a per-row error: the row is held, never stored
    // with a silently dropped spec.
    let validatedSpecs: SpecEntryInput[] | undefined;
    if (input.specParseErrors && input.specParseErrors.length > 0) {
      for (const reason of input.specParseErrors) {
        errors.push({ row, field: 'specs', reason });
      }
    } else if (input.specs && input.specs.length > 0) {
      const specCheck = validateSpecEntries(input.category, input.specs);
      if (!specCheck.valid) {
        for (const reason of specCheck.errors) {
          errors.push({ row, field: 'specs', reason });
        }
      } else {
        validatedSpecs = specCheck.validEntries;
      }
    }
    // FINAL 100%, F-P2-09 (code half) — CSV variants are
    // validated (name required, variant GTIN GS1-checked). An
    // invalid variant holds the row with a reason, never a
    // silently dropped variant.
    let validatedVariants: ProductVariantInput[] | undefined;
    if (input.variantParseErrors && input.variantParseErrors.length > 0) {
      for (const reason of input.variantParseErrors) {
        errors.push({ row, field: 'variants', reason });
      }
    } else if (input.variants && input.variants.length > 0) {
      const variantErrors: string[] = [];
      for (const variant of input.variants) {
        const check = validateProductVariant(variant);
        if (!check.valid) variantErrors.push(...check.errors.map((e) => `Variant "${variant.name}": ${e}`));
      }
      if (variantErrors.length > 0) {
        for (const reason of variantErrors) {
          errors.push({ row, field: 'variants', reason });
        }
      } else {
        validatedVariants = input.variants;
      }
    }

    const slug = input.slug.toLowerCase();
    const nameBrandKey =
      input.name && input.brand ? intakeNameBrandKey(input.name, input.brand) : '';

    let status: IntakeRowStatus;
    let duplicateOf: string | undefined;
    let nearDuplicateOf: string | undefined;
    let duplicateDetail: string | undefined;

    // Section 20, #9 — same GTIN under a different slug is a
    // duplicate candidate, held for manual review. Before this
    // leg, intake checked only the slug and the normalized
    // name+brand, so a row carrying an existing product's GTIN
    // under a fresh slug passed as 'valid' and would have
    // created a second catalog row for the same physical
    // product. It is 'near-duplicate' (not 'duplicate') so an
    // admin who has genuinely checked — e.g. a GTIN reused
    // across a variant family — can still include it explicitly.
    const gtinKey = input.gtin ? normalizeGtin(input.gtin) : '';
    const existingGtinSlug = gtinKey
      ? (context.existingGtins?.get(gtinKey) ?? undefined)
      : undefined;
    const seenGtinRow = gtinKey ? seenGtins.get(gtinKey) : undefined;

    // FINAL 100% (F-P1-45/F-P1-46): the MODEL leg. Same
    // normalized model + same normalized brand is a
    // near-duplicate hold — a model leg never auto-merges, and a
    // same-model re-ingest under a different name must be held
    // instead of creating a second row. Missing model on either
    // side means no model leg at all.
    const normalizedModel = normalizeModel(input.modelNumber ?? null);
    const normalizedBrandKey = normalizeBrand(input.brand ?? null);
    const modelBrandKey =
      normalizedModel && normalizedBrandKey ? `${normalizedModel}|${normalizedBrandKey}` : '';
    const existingModelSlug = modelBrandKey
      ? (context.existingModels?.get(modelBrandKey) ?? undefined)
      : undefined;
    const seenModelRow = modelBrandKey ? seenModels.get(modelBrandKey) : undefined;

    if (errors.length > 0) {
      status = 'error';
    } else if (context.existingSlugs.has(slug) || seenSlugs.has(slug)) {
      status = 'duplicate';
      duplicateOf = context.existingSlugs.has(slug) ? slug : slug;
    } else if (existingGtinSlug) {
      status = 'near-duplicate';
      nearDuplicateOf = existingGtinSlug;
      duplicateDetail =
        `Same GTIN (${input.gtin}) as "${existingGtinSlug}" — the same product under a different slug. ` +
        `Check before including; a second catalog row for the same GTIN is a duplicate.`;
    } else if (seenGtinRow !== undefined && seenGtinRow !== row) {
      status = 'near-duplicate';
      nearDuplicateOf = `row ${seenGtinRow} in this file`;
      duplicateDetail =
        `Same GTIN (${input.gtin}) as row ${seenGtinRow} in this file. ` +
        `Check before including; a second catalog row for the same GTIN is a duplicate.`;
    } else if (existingModelSlug) {
      status = 'near-duplicate';
      nearDuplicateOf = existingModelSlug;
      duplicateDetail =
        `Same model number "${input.modelNumber}" (normalized ${normalizedModel}) as "${existingModelSlug}" with the same brand "${input.brand}". ` +
        `Check before including; this may be the same product under a different name.`;
    } else if (seenModelRow !== undefined && seenModelRow !== row) {
      status = 'near-duplicate';
      nearDuplicateOf = `row ${seenModelRow} in this file`;
      duplicateDetail =
        `Same model number "${input.modelNumber}" (normalized ${normalizedModel}) as row ${seenModelRow} in this file with the same brand "${input.brand}". ` +
        `Check before including; this may be the same product under a different name.`;
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
        // Section 21–25, Stage C (B3) — fuzzy leg. Same brand +
        // similar name (≥ 0.75) is a near-duplicate even when the
        // normalized name is not identical: "MacBook Air 13-inch"
        // vs "MacBook Air 13" is the same product reworded, not a
        // new one. Catalog first, then earlier rows in this file.
        // The detail names the similarity so the reviewer can see
        // WHY the row was held — a fuzzy hold is a judgement call,
        // not a certainty.
        const fuzzyKey = findFuzzyNameBrandKey(
          input.name,
          input.brand,
          context.existingNameBrands.keys()
        );
        const fuzzySeenKey = fuzzyKey
          ? null
          : findFuzzyNameBrandKey(input.name, input.brand, seenNameBrands.keys());
        // FINAL 100% (F-P1-45): a model conflict vetoes the fuzzy
        // hold — similar names for DIFFERENT recorded models are
        // different products, not a near-duplicate. Missing model
        // on either side is not a conflict (modelsConflict is
        // false when either side is absent).
        const fuzzyModelVeto = ((): boolean => {
          if (fuzzyKey) {
            const fuzzySlug = context.existingNameBrands.get(fuzzyKey);
            const existingModel = fuzzySlug
              ? (context.existingModelsBySlug?.get(fuzzySlug) ?? null)
              : null;
            return modelsConflict(input.modelNumber ?? null, existingModel);
          }
          if (fuzzySeenKey) {
            const fuzzySeenRow = seenNameBrands.get(fuzzySeenKey);
            const seenModel =
              fuzzySeenRow !== undefined ? (seenRowModels.get(fuzzySeenRow) ?? null) : null;
            return modelsConflict(input.modelNumber ?? null, seenModel);
          }
          return false;
        })();
        if (fuzzyKey && !fuzzyModelVeto) {
          const fuzzySlug = context.existingNameBrands.get(fuzzyKey);
          const similarity = nearMissSimilarity(
            normalizeIntakeKey(input.name),
            fuzzyKey.slice(0, fuzzyKey.indexOf('|'))
          );
          status = 'near-duplicate';
          nearDuplicateOf = fuzzySlug;
          duplicateDetail =
            `Similar name "${input.name}" to "${fuzzySlug}" (similarity ${similarity.toFixed(2)}) with the same brand "${input.brand}". ` +
            `Check before including; this may be the same product reworded.`;
        } else if (fuzzySeenKey && !fuzzyModelVeto) {
          const fuzzySeenRow = seenNameBrands.get(fuzzySeenKey);
          const similarity = nearMissSimilarity(
            normalizeIntakeKey(input.name),
            fuzzySeenKey.slice(0, fuzzySeenKey.indexOf('|'))
          );
          status = 'near-duplicate';
          nearDuplicateOf = `row ${fuzzySeenRow} in this file`;
          duplicateDetail =
            `Similar name "${input.name}" to row ${fuzzySeenRow} in this file (similarity ${similarity.toFixed(2)}) with the same brand "${input.brand}". ` +
            `Check before including; this may be the same product reworded.`;
        } else {
          status = 'valid';
        }
      }
    } else {
      status = 'valid';
    }

    if (status === 'valid' || status === 'near-duplicate') {
      seenSlugs.add(slug);
      if (nameBrandKey && !seenNameBrands.has(nameBrandKey)) {
        seenNameBrands.set(nameBrandKey, row);
      }
      if (gtinKey && !seenGtins.has(gtinKey)) {
        seenGtins.set(gtinKey, row);
      }
      if (modelBrandKey && !seenModels.has(modelBrandKey)) {
        seenModels.set(modelBrandKey, row);
      }
      if (!seenRowModels.has(row)) {
        seenRowModels.set(row, normalizedModel);
      }
    }

    reviewed.push({
      rowNumber: row,
      status,
      errors,
      ...(duplicateOf ? { duplicateOf } : {}),
      ...(nearDuplicateOf ? { nearDuplicateOf } : {}),
      ...(duplicateDetail ? { duplicateDetail } : {}),
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
              // Section 20, §12 #31/#94 — store the validated,
              // normalized values (digits-only GTIN, trimmed image
              // URL), never the raw input.
              ...(normalizedImageUrl ? { imageUrl: normalizedImageUrl } : {}),
              ...(normalizedGtin ? { gtin: normalizedGtin } : {}),
              ...(input.sku ? { sku: input.sku } : {}),
              ...(input.modelNumber ? { modelNumber: input.modelNumber } : {}),
              ...(validatedSpecs ? { specs: validatedSpecs } : {}),
              ...(validatedVariants ? { variants: validatedVariants } : {}),
              ...(normalizedImageUrls.length > 0 ? { imageUrls: normalizedImageUrls } : {}),
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
    // FINAL 100%, F-P2-34 — gallery URLs ride the plan: the
    // primary image_url first, then the validated image_urls,
    // deduped. Approve writes them as product_images rows.
    const galleryUrls = [
      ...(d.imageUrl ? [d.imageUrl] : []),
      ...(d.imageUrls ?? []),
    ].filter((url, i, arr) => arr.indexOf(url) === i);
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
        // Section 20, #6: stored only when the column exists —
        // the intake route retries without it on 42703 (055
        // unapplied) instead of failing the batch.
        ...(d.modelNumber ? { model_number: d.modelNumber } : {}),
      },
      merchantProduct: {
        merchantId: d.merchantId,
        price: d.price,
        currencyId: d.currencyId,
        ...(d.sku ? { merchantSku: d.sku } : {}),
      },
      ...(d.specs ? { specs: d.specs } : {}),
      ...(d.variants ? { variants: d.variants } : {}),
      ...(galleryUrls.length > 0 ? { galleryUrls } : {}),
    });
  }

  return plans;
}
