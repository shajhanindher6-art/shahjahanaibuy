import { describe, it, expect } from 'vitest';
import {
  buildProductDescription,
  buildProductJsonLd,
  buildProductMetadata,
  toInitialProduct,
  type ProductSeoData,
} from '@/lib/product-seo';

// P0 fix (2026-11-09 audit): all 11 products shared one generic
// title/description and the JSON-LD/h1 only existed after client JS.

const SITE = 'https://shahjahanaibuy-b1zp.vercel.app';

const macbook: ProductSeoData = {
  id: '3aa8470f-7bcd-448d-bd09-bd1ce13c31f6',
  name: 'MacBook Air 13',
  slug: 'macbook-air-13',
  description: 'Apple MacBook Air 13 with M-series chip.',
  brand: 'Apple',
  category: 'Laptops',
  imageUrl: 'https://example.com/macbook.jpg',
  gtin: null,
  confidenceScore: 95,
  lowestPrice: 999,
  priceValidUntil: null,
  inStock: true,
  averageRating: 0,
  reviewCount: 0,
  // Section 15 P1-11: recorded freshness travels with the SEO facts.
  dataFreshness: '2026-11-02T07:13:52.000Z',
};

/** The Product node inside the @graph document buildProductJsonLd emits. */
function productNode(seo: ProductSeoData) {
  const doc = JSON.parse(buildProductJsonLd(seo, SITE));
  expect(doc['@context']).toBe('https://schema.org');
  const product = doc['@graph'].find(
    (node: { '@type'?: string }) => node['@type'] === 'Product'
  );
  expect(product).toBeDefined();
  return { doc, product };
}

function breadcrumbNode(seo: ProductSeoData) {
  const { doc } = productNode(seo);
  const breadcrumb = doc['@graph'].find(
    (node: { '@type'?: string }) => node['@type'] === 'BreadcrumbList'
  );
  expect(breadcrumb).toBeDefined();
  return breadcrumb;
}

describe('buildProductMetadata', () => {
  it('uses the product name as title and a per-product canonical', () => {
    const meta = buildProductMetadata(macbook, SITE);
    // The root layout template appends " | SmartBuy AI".
    expect(meta.title).toBe('MacBook Air 13');
    expect(meta.alternates?.canonical).toBe(
      `${SITE}/products/macbook-air-13`
    );
    expect(meta.description).toBe('Apple MacBook Air 13 with M-series chip.');
    const og = meta.openGraph as { title?: string; url?: string; locale?: string };
    expect(og.title).toBe('MacBook Air 13 — SmartBuy AI');
    expect(og.url).toBe(`${SITE}/products/macbook-air-13`);
    expect(og.locale).toBe('en_US');
  });

  it('never invents a twitter handle', () => {
    const meta = buildProductMetadata(macbook, SITE);
    const twitter = meta.twitter as { site?: string; creator?: string };
    expect(twitter.site).toBeUndefined();
    expect(twitter.creator).toBeUndefined();
  });

  it('falls back to a generated description when none is recorded', () => {
    const meta = buildProductMetadata(
      { ...macbook, description: null },
      SITE
    );
    expect(meta.description).toContain('MacBook Air 13');
    expect(meta.description).toContain('Apple');
  });

  it('omits images when the product has no image URL', () => {
    const meta = buildProductMetadata({ ...macbook, imageUrl: null }, SITE);
    const og = meta.openGraph as { images?: unknown };
    expect(og.images).toBeUndefined();
  });
});

describe('buildProductDescription', () => {
  it('prefers the recorded description', () => {
    expect(buildProductDescription(macbook)).toBe(
      'Apple MacBook Air 13 with M-series chip.'
    );
  });
});

describe('buildProductJsonLd', () => {
  it('includes offers with the recorded lowest price and stock state', () => {
    const { product } = productNode(macbook);
    expect(product.name).toBe('MacBook Air 13');
    expect(product.offers.price).toBe(999);
    expect(product.offers.priceCurrency).toBe('USD');
    expect(product.offers.availability).toBe('https://schema.org/InStock');
    expect(product.offers.url).toBe(`${SITE}/products/macbook-air-13`);
  });

  it('omits priceValidUntil when no validity date is recorded', () => {
    const { product } = productNode(macbook);
    expect(product.offers.priceValidUntil).toBeUndefined();
  });

  it('includes priceValidUntil when a real validity date is recorded', () => {
    const { product } = productNode({
      ...macbook,
      priceValidUntil: '2026-12-31',
    });
    expect(product.offers.priceValidUntil).toBe('2026-12-31');
  });

  it('includes a Home → product BreadcrumbList in the same graph', () => {
    const breadcrumb = breadcrumbNode(macbook);
    expect(breadcrumb.itemListElement).toEqual([
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: `${SITE}/`,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'MacBook Air 13',
      },
    ]);
  });

  it('omits offers when there is no priced listing', () => {
    const { product } = productNode({
      ...macbook,
      lowestPrice: null,
      inStock: null,
    });
    expect(product.offers).toBeUndefined();
  });

  it('never emits an aggregate rating with zero reviews', () => {
    const { product } = productNode(macbook);
    expect(product.aggregateRating).toBeUndefined();
  });

  it('emits an aggregate rating only with real reviews', () => {
    const { product } = productNode({
      ...macbook,
      averageRating: 4.5,
      reviewCount: 12,
    });
    expect(product.aggregateRating.ratingValue).toBe(4.5);
    expect(product.aggregateRating.reviewCount).toBe(12);
  });

  it('marks OutOfStock when listings exist but none is in stock', () => {
    const { product } = productNode({ ...macbook, inStock: false });
    expect(product.offers.availability).toBe(
      'https://schema.org/OutOfStock'
    );
  });
});

describe('toInitialProduct', () => {
  it('maps only the fields the client component renders first', () => {
    const initial = toInitialProduct(macbook);
    expect(initial).toEqual({
      id: macbook.id,
      name: 'MacBook Air 13',
      slug: 'macbook-air-13',
      description: 'Apple MacBook Air 13 with M-series chip.',
      brand: 'Apple',
      category: 'Laptops',
      imageUrl: 'https://example.com/macbook.jpg',
      gtin: null,
      confidenceScore: 95,
    });
    expect('lowestPrice' in initial).toBe(false);
  });
});
