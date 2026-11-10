/**
 * Programmatic SEO for brand / category listing pages (Section 9, chunk 2).
 *
 * Pure builders + slug resolution — no database, no network — so they
 * run in the plain-Node vitest environment (same split as
 * lib/product-seo.ts vs lib/product-seo-server.ts).
 *
 * DATA RULES (honesty, same as the rest of the SEO layer):
 * - Slugs are derived ONLY from values actually present in the
 *   catalog: the `brands` / `categories` reference rows (via the
 *   same services the /api/v1/brands and /api/v1/categories routes
 *   use) and the `brand` / `category` text columns of real product
 *   rows. Nothing is invented: a brand/category with no products
 *   renders an honest empty state, and a slug that matches neither
 *   a reference row nor any product resolves to null so the page
 *   can 404 (see resolveTaxonomyPage).
 * - The sitemap only ever lists slugs derived from real product
 *   rows, so every sitemap URL has at least one product behind it.
 */

import type { Metadata } from 'next';
import {
  buildBreadcrumbJsonLd,
  buildItemListJsonLd,
  toJsonLdGraph,
} from '@/lib/json-ld';

export type TaxonomyKind = 'brand' | 'category';

/** Minimal product shape a listing page needs (subset of Product). */
export interface TaxonomyProduct {
  name: string;
  slug: string;
  description: string | null;
  brand: string | null;
  category: string | null;
}

/** Minimal reference-row shape (subset of Brand / Category). */
export interface TaxonomyRecord {
  name: string;
  slug: string;
  description: string | null;
}

export interface TaxonomyPageData {
  kind: TaxonomyKind;
  slug: string;
  name: string;
  description: string | null;
  products: TaxonomyProduct[];
}

/** "Apple Inc." -> "apple-inc"; "Home & Garden" -> "home-garden". */
export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface TaxonomySlug {
  name: string;
  slug: string;
}

/**
 * Distinct { name, slug } pairs from raw text values (e.g. every
 * product's `brand` column). Null / blank values are skipped, and
 * names that slugify to the same slug collapse to the first name
 * seen — so the list is derived from the catalog only, never
 * invented. Sorted by name for stable output.
 */
export function deriveTaxonomySlugs(
  values: Array<string | null>
): TaxonomySlug[] {
  const seen = new Map<string, string>();
  for (const value of values) {
    if (!value) continue;
    const name = value.trim();
    if (!name) continue;
    const slug = slugify(name);
    if (!slug) continue;
    if (!seen.has(slug)) seen.set(slug, name);
  }
  return Array.from(seen.entries())
    .map(([slug, name]) => ({ name, slug }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Find the catalog value whose slug matches, or null. */
export function matchTaxonomyName(
  slug: string,
  values: Array<string | null>
): string | null {
  for (const value of values) {
    if (!value) continue;
    if (slugify(value) === slug) return value.trim();
  }
  return null;
}

function productField(product: TaxonomyProduct, kind: TaxonomyKind): string | null {
  return kind === 'brand' ? product.brand : product.category;
}

/**
 * Resolve a /brands/[slug] or /categories/[slug] URL to page data.
 *
 * - `record` is the `brands` / `categories` reference row for the
 *   slug (same lookup the API detail routes do), or null when the
 *   slug is not a reference-row slug.
 * - `products` are the catalog product rows to match against.
 *
 * Returns null when the slug matches nothing at all — the caller
 * 404s. Returns page data with an empty `products` array when the
 * reference row exists but no product carries that brand/category
 * — the caller renders the honest empty state, never invented
 * products. A slug that is only derivable from product rows (no
 * reference row) still resolves, using the product value as the
 * display name.
 */
export function resolveTaxonomyPage(args: {
  kind: TaxonomyKind;
  slug: string;
  record: TaxonomyRecord | null;
  products: TaxonomyProduct[];
}): TaxonomyPageData | null {
  const { kind, slug, record, products } = args;
  const name =
    record?.name ??
    matchTaxonomyName(
      slug,
      products.map((p) => productField(p, kind))
    );
  if (!name) return null;

  // A product matches when its brand/category slugifies to the URL
  // slug — or to the reference row's name, which covers a reference
  // row whose display name differs slightly from the product text
  // (e.g. record "Apple Inc." vs product brand "Apple").
  const accepted = new Set([slug]);
  if (record) accepted.add(slugify(record.name));
  const matched = products.filter((p) => {
    const value = productField(p, kind);
    return value !== null && accepted.has(slugify(value));
  });

  return {
    kind,
    slug,
    name,
    description: record?.description ?? null,
    products: matched,
  };
}

/**
 * Per-page metadata. Title is the bare listing name on purpose:
 * the root layout's title template appends " | SmartBuy AI".
 */
export function buildTaxonomyMetadata(
  page: TaxonomyPageData,
  siteUrl: string
): Metadata {
  const basePath = page.kind === 'brand' ? '/brands' : '/categories';
  const url = `${siteUrl}${basePath}/${page.slug}`;
  const kindLabel = page.kind === 'brand' ? 'brand' : 'category';
  const description =
    page.description ??
    `Compare ${page.name} ${kindLabel} products — browse every ${page.name} product in the SmartBuy AI catalog, compare prices across retailers and track price history.`;
  return {
    title: `${page.name} products`,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: `${page.name} products — SmartBuy AI`,
      description,
      url,
      type: 'website',
      locale: 'en_US',
    },
    twitter: {
      card: 'summary',
      title: `${page.name} products — SmartBuy AI`,
      description,
      // NOTE: no `site` / `creator` — those need a real @handle
      // and SmartBuy AI has no verified X/Twitter handle on record
      // (same rule as lib/product-seo.ts).
    },
  };
}

/**
 * Server-rendered JSON-LD in one `@graph` document: a BreadcrumbList
 * (Home → this listing) always, plus an ItemList of the real product
 * pages when the listing has products. An empty listing emits no
 * ItemList — an empty list would claim products that do not exist.
 */
export function buildTaxonomyJsonLd(
  page: TaxonomyPageData,
  siteUrl: string
): string {
  const breadcrumb = buildBreadcrumbJsonLd(siteUrl, [
    { name: 'Home', path: '/' },
    { name: `${page.name} products` },
  ]);
  if (page.products.length === 0) {
    return toJsonLdGraph(breadcrumb);
  }
  const itemList = buildItemListJsonLd(
    siteUrl,
    page.products.map((p) => ({ name: p.name, path: `/products/${p.slug}` }))
  );
  return toJsonLdGraph(breadcrumb, itemList);
}

export interface TaxonomySitemapEntry {
  url: string;
  changeFrequency: 'weekly';
  priority: number;
}

/**
 * Sitemap entries for every brand / category slug derived from real
 * product rows — the same style as the product entries in
 * app/sitemap.ts (absolute URL, weekly, 0.6). Slugs come from the
 * products table only, so every URL has at least one product.
 */
export function buildTaxonomySitemapEntries(
  baseUrl: string,
  products: Array<{ brand: string | null; category: string | null }>
): TaxonomySitemapEntry[] {
  const brands = deriveTaxonomySlugs(products.map((p) => p.brand));
  const categories = deriveTaxonomySlugs(products.map((p) => p.category));
  return [
    ...brands.map((b) => ({
      url: `${baseUrl}/brands/${b.slug}`,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
    ...categories.map((c) => ({
      url: `${baseUrl}/categories/${c.slug}`,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
  ];
}
