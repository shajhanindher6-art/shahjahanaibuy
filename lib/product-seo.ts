/**
 * Server-side product data for SEO (P0 fix, 2026-11-09 audit).
 *
 * Product pages were 100% client-rendered: every product shared one
 * generic <title>, and the h1, description and JSON-LD only existed
 * after JavaScript ran and the API answered — a no-JS view of the
 * MacBook page showed nothing but the generic title, so Google saw
 * no product at all. The pure builders in this module turn the small
 * set of facts the server page needs (product row, cheapest recorded
 * merchant price, review aggregate — fetched by
 * lib/product-seo-server.ts) into metadata + JSON-LD before any
 * client JavaScript runs.
 *
 * Only RECORDED data is used here, with the same honesty rules as
 * the client page: no offers block when there is no priced listing,
 * no availability claim when listings are unknown, and no aggregate
 * rating when there are zero real reviews.
 */

import type { Metadata } from 'next';
import {
  buildBreadcrumbJsonLd,
  toJsonLdGraph,
} from '@/lib/json-ld';

export interface ProductSeoData {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
  gtin: string | null;
  confidenceScore: number;
  /** Cheapest recorded merchant price, or null when no priced listing exists. */
  lowestPrice: number | null;
  /**
   * Recorded `products.data_freshness` — when this product's prices
   * were last checked (Section 15 P1-11: the product page renders
   * "Prices last checked" server-side from this value). Null when
   * the row carries no freshness timestamp; the page then renders
   * no label rather than an invented date.
   */
  dataFreshness: string | null;
  /**
   * ISO date until which the recorded price is valid, or null.
   * Merchant data carries no validity window, so this is null today
   * and the Offer omits priceValidUntil rather than inventing one
   * (seed prices are demo figures — claiming they hold until a date
   * would misrepresent them). When a live price source with a real
   * validity window arrives, populate it in lib/product-seo-server.ts.
   */
  priceValidUntil: string | null;
  /** True when any listing is in stock; null when no listings exist. */
  inStock: boolean | null;
  averageRating: number;
  reviewCount: number;
}

/** The product fields the client component accepts as its initial (SSR) data. */
export interface ProductInitialData {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
  gtin: string | null;
  confidenceScore: number;
}

export function toInitialProduct(seo: ProductSeoData): ProductInitialData {
  return {
    id: seo.id,
    name: seo.name,
    slug: seo.slug,
    description: seo.description,
    brand: seo.brand,
    category: seo.category,
    imageUrl: seo.imageUrl,
    gtin: seo.gtin,
    confidenceScore: seo.confidenceScore,
  };
}

export function buildProductDescription(seo: ProductSeoData): string {
  if (seo.description) return seo.description;
  const brand = seo.brand ? ` by ${seo.brand}` : '';
  return (
    `${seo.name}${brand} — compare prices across retailers, track ` +
    `price history and check the deal score on SmartBuy AI.`
  );
}

/**
 * Per-product metadata. Title is the bare product name on purpose:
 * the root layout's title template appends " | SmartBuy AI".
 */
export function buildProductMetadata(
  seo: ProductSeoData,
  siteUrl: string
): Metadata {
  const description = buildProductDescription(seo);
  const url = `${siteUrl}/products/${seo.slug}`;
  const ogTitle = `${seo.name} — SmartBuy AI`;
  return {
    title: seo.name,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: ogTitle,
      description,
      url,
      type: 'website',
      locale: 'en_US',
      images: seo.imageUrl
        ? [{ url: seo.imageUrl, alt: seo.name }]
        : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description,
      images: seo.imageUrl ? [seo.imageUrl] : undefined,
      // NOTE: no `site` / `creator` here — those need a real @handle
      // and SmartBuy AI has no verified X/Twitter handle on record.
      // Inventing one would put a false handle in every product
      // page's metadata. Owner step: add the real handle here (and
      // in the root layout) once the account exists — see docs/seo.md.
    },
  };
}

/**
 * Server-rendered Product JSON-LD, plus a BreadcrumbList, in one
 * `@graph` document. Same honesty rules as the client page used to
 * apply: offers only with a recorded price, availability only when
 * listings are known, aggregateRating only with ≥1 review,
 * priceValidUntil only when a real validity date is recorded.
 * There is no /products index page, so the breadcrumb is
 * Home → this product.
 */
export function buildProductJsonLd(
  seo: ProductSeoData,
  siteUrl: string
): string {
  const url = `${siteUrl}/products/${seo.slug}`;
  const product: Record<string, unknown> = {
    '@type': 'Product',
    name: seo.name,
    description: seo.description ?? undefined,
    brand: seo.brand ? { '@type': 'Brand', name: seo.brand } : undefined,
    category: seo.category ?? undefined,
    image: seo.imageUrl ?? undefined,
    gtin: seo.gtin ?? undefined,
    url,
    offers:
      seo.lowestPrice !== null
        ? {
            '@type': 'Offer',
            price: seo.lowestPrice,
            priceCurrency: 'USD',
            url,
            ...(seo.priceValidUntil
              ? { priceValidUntil: seo.priceValidUntil }
              : {}),
            availability:
              seo.inStock === null
                ? undefined
                : seo.inStock
                  ? 'https://schema.org/InStock'
                  : 'https://schema.org/OutOfStock',
          }
        : undefined,
    aggregateRating:
      seo.reviewCount > 0
        ? {
            '@type': 'AggregateRating',
            ratingValue: seo.averageRating,
            reviewCount: seo.reviewCount,
          }
        : undefined,
  };
  const breadcrumb = buildBreadcrumbJsonLd(siteUrl, [
    { name: 'Home', path: '/' },
    { name: seo.name },
  ]);
  return toJsonLdGraph(product, breadcrumb);
}
