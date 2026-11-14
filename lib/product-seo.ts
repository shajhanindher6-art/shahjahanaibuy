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
  deriveOfferPriceValidUntil,
  getFreshnessStatus,
  STALE_PRICE_DAYS,
} from '@/lib/price-freshness';
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
  /**
   * FINAL 100%, F-P2-33 — per-image verification verdict for the
   * primary gallery image (migration 069; null when unknown or
   * when the product has no gallery rows). buildProductMetadata
   * emits og:image / twitter:image only when the image is not
   * KNOWN broken: 'unreachable' / 'invalid' suppress the tags,
   * 'verified' / 'unchecked' / null keep the previous behaviour
   * (the products.image_url hotlink). Honest-empty when no image
   * URL exists at all.
   */
  imageVerificationStatus?: import('@/services/pipeline/image-processing').ImageVerificationStatus | null;
  /**
   * Final 100% — F-P2-03 (legacy, optional): the pipeline's
   * field-presence count. Never rendered, never a completion
   * score; kept optional so older literals keep compiling.
   */
  confidenceScore?: number;
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
   *
   * POLICY (Section 16, item 12): crawlers used to read the
   * 10-day-stale recorded price as a current offer with no validity
   * date at all. Merchant data carries no validity window, so the
   * date is DERIVED, never invented: data_freshness + the 7-day
   * stale threshold (STALE_PRICE_DAYS, same threshold as the stale
   * badge on the product page) — the price is treated as valid
   * until the day it would be called stale. And once the recorded
   * price IS stale (older than 7 days), buildProductJsonLd drops
   * the offers block entirely (see below), so no crawler ever reads
   * a stale price as a current offer. A null here means "no
   * validity date": either no freshness is recorded, or the price
   * is already stale. lib/product-seo-server.ts computes this from
   * the row's data_freshness at request time.
   */
  priceValidUntil: string | null;
  /** True when any listing is in stock; null when no listings exist. */
  inStock: boolean | null;
  averageRating: number;
  reviewCount: number;
  /**
   * Section 17, Stage C item 14 (migration 045, unapplied):
   * verification of the shown lowest price. Optional so older
   * ProductSeoData literals (tests) keep compiling — the page
   * treats a missing value as 'unverified'. Sourced from the
   * cheapest listing when one exists, else the product rollup.
   */
  priceVerificationStatus?: import('@/services/price-verification').PriceVerificationStatus;
  priceVerifiedAt?: string | null;
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
  /** Final 100% — F-P2-03: legacy field-presence count, optional, never rendered. */
  confidenceScore?: number;
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
  // FINAL 100%, F-P2-33 — social image only when a (verified or
  // unchecked) image exists; a KNOWN-broken image is never
  // advertised to crawlers, and no image means no og:image /
  // twitter:image tags at all (honest-empty).
  const socialImageUrl =
    seo.imageUrl &&
    seo.imageVerificationStatus !== 'unreachable' &&
    seo.imageVerificationStatus !== 'invalid'
      ? seo.imageUrl
      : null;
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
      images: socialImageUrl
        ? [{ url: socialImageUrl, alt: seo.name }]
        : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description,
      images: socialImageUrl ? [socialImageUrl] : undefined,
      // NOTE: no `site` / `creator` here — those need a real @handle
      // and SmartBuy AI has no verified X/Twitter handle on record.
      // Inventing one would put a false handle in every product
      // page's metadata. Owner step: add the real handle here (and
      // in the root layout) once the account exists — see docs/seo.md.
    },
  };
}

/**
 * Derive the offer validity date from the recorded freshness
 * (Section 16, item 12 policy — see ProductSeoData.priceValidUntil).
 *
 * S2-6: the implementation lives in lib/price-freshness.ts
 * (deriveOfferPriceValidUntil) — this is a delegating re-export so
 * existing importers (lib/product-seo-server.ts, tests) keep
 * working unchanged. Do not re-implement the arithmetic here.
 */
export { deriveOfferPriceValidUntil } from '@/lib/price-freshness';

/**
 * Server-rendered Product JSON-LD, plus a BreadcrumbList, in one
 * `@graph` document. Same honesty rules as the client page used to
 * apply: offers only with a recorded price, availability only when
 * listings are known, aggregateRating only with ≥1 review.
 * The /products index page exists (Section 14); this breadcrumb
 * still lists Home → this product only, matching the page's own
 * breadcrumb trail — the index is not a step on the product trail.
 *
 * Section 16, item 12: the offers block is SUPPRESSED when the
 * recorded price is stale (older than STALE_PRICE_DAYS) — crawlers
 * must never read a stale price as a current offer. Final 100%
 * (F-P2-16): an UNKNOWN age suppresses the offer too — a missing
 * check date is not "not stale", so no offer renders without a
 * known-fresh price. While fresh, the offer carries
 * priceValidUntil (recorded when present, otherwise derived from
 * data_freshness by deriveOfferPriceValidUntil). `now` is
 * injectable for tests; it defaults to the request time.
 */
export function buildProductJsonLd(
  seo: ProductSeoData,
  siteUrl: string,
  now: Date = new Date()
): string {
  const url = `${siteUrl}/products/${seo.slug}`;
  // Stale recorded price → no offer at all (see the policy above).
  // Final 100% — F-P2-16: an UNKNOWN age is treated the same way.
  // isPriceStale returns false when no check date is recorded, and
  // that false used to read as "not stale" — i.e. implicitly fresh
  // — so an offer with no recorded freshness still rendered. An
  // offer is only shown when the price is KNOWN fresh; unknown age
  // suppresses the offer exactly like stale age does.
  const freshness = getFreshnessStatus(seo.dataFreshness, now);
  const offerStale = freshness.status !== 'fresh';
  const showOffer = seo.lowestPrice !== null && !offerStale;
  const priceValidUntil =
    seo.priceValidUntil ?? deriveOfferPriceValidUntil(seo.dataFreshness, now);
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
      showOffer
        ? {
            '@type': 'Offer',
            price: seo.lowestPrice,
            priceCurrency: 'USD',
            url,
            ...(priceValidUntil ? { priceValidUntil } : {}),
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
