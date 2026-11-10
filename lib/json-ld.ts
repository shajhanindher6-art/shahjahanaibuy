/**
 * JSON-LD serialization for inline <script type="application/ld+json">.
 *
 * Plain JSON.stringify does NOT escape `<`, so a `</script>` sequence
 * inside the data (a product name or description) would close the
 * script element and let the rest of the string parse as HTML — a
 * stored-XSS vector if that data ever becomes user-influenced.
 * Escaping `<` as \u003c keeps the JSON valid (JSON parsers decode
 * the escape) while making breakout impossible.
 */
export function toJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * Structured-data suite (S4#15, 2026-11-10).
 *
 * Every builder below returns a complete standalone schema object
 * (with its own `@context`) that can be emitted in its own script
 * tag. `toJsonLdGraph` combines several of them into one `@graph`
 * document for pages that emit a single script tag (product page,
 * blog article) — it strips the duplicated `@context` from each
 * member and keeps one at the top.
 *
 * Honesty rules, same as the rest of the SEO layer: builders only
 * ever receive recorded data. Nothing here invents a social profile,
 * a rating, a price-validity window or an author — optional fields
 * are omitted when the source data does not have them.
 */

/** Site-wide Organization schema. Logo is the real PWA icon in public/. */
export function buildOrganizationJsonLd(
  siteUrl: string
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'SmartBuy AI',
    url: siteUrl,
    logo: `${siteUrl}/icon-192.png`,
  };
}

export interface BreadcrumbCrumb {
  name: string;
  /** Path from the site root (e.g. '/blog'). Omit for the current page. */
  path?: string | null;
}

/** BreadcrumbList for a page. The last crumb (current page) has no URL. */
export function buildBreadcrumbJsonLd(
  siteUrl: string,
  crumbs: BreadcrumbCrumb[]
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      ...(crumb.path ? { item: `${siteUrl}${crumb.path}` } : {}),
    })),
  };
}

/**
 * WebSite schema. `searchUrlTemplate` adds the SearchAction
 * (sitelinks search box) — pass it ONLY when the target actually
 * honours the query: /search does not read `?q=` yet (Section 2,
 * item 30g), so no page wires a SearchAction today. When /search
 * gains `?q=` support, wire `${siteUrl}/search?q={search_term_string}`.
 */
export function buildWebSiteJsonLd(
  siteUrl: string,
  searchUrlTemplate?: string | null
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'SmartBuy AI',
    url: siteUrl,
    ...(searchUrlTemplate
      ? {
          potentialAction: {
            '@type': 'SearchAction',
            target: {
              '@type': 'EntryPoint',
              urlTemplate: searchUrlTemplate,
            },
            'query-input': 'required name=search_term_string',
          },
        }
      : {}),
  };
}

/** FAQPage from real Q&A pairs. Never invent questions or answers. */
export function buildFaqJsonLd(
  faqs: Array<{ question: string; answer: string }>
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: { '@type': 'Answer', text: faq.answer },
    })),
  };
}

export interface ItemListEntry {
  name: string;
  /** Path from the site root (e.g. '/products/macbook-air-13'). */
  path: string;
}

/**
 * ItemList for search results / category / listing pages: each entry
 * is a real page that exists. Callers pass only real URLs.
 */
export function buildItemListJsonLd(
  siteUrl: string,
  items: ItemListEntry[]
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      url: `${siteUrl}${item.path}`,
    })),
  };
}

export interface ArticleJsonLdInput {
  slug: string;
  title: string;
  excerpt: string;
  /** ISO date (YYYY-MM-DD), from the post's recorded datePublished. */
  datePublished: string;
  /** ISO date, only when the post records a later update. */
  lastUpdated?: string | null;
  /** Named author, only when the post records one. */
  authorName?: string | null;
  /** Absolute image URL, only when the post has one. */
  imageUrl?: string | null;
}

/**
 * Article schema for a blog post. Author is a Person when a name is
 * recorded, otherwise the publishing Organization — never an invented
 * person. `dateModified` appears only when a real update date exists.
 */
export function buildArticleJsonLd(
  siteUrl: string,
  post: ArticleJsonLdInput
): Record<string, unknown> {
  const url = `${siteUrl}/blog/${post.slug}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.excerpt,
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    datePublished: post.datePublished,
    ...(post.lastUpdated ? { dateModified: post.lastUpdated } : {}),
    author: post.authorName
      ? { '@type': 'Person', name: post.authorName }
      : { '@type': 'Organization', name: 'SmartBuy AI', url: siteUrl },
    publisher: {
      '@type': 'Organization',
      name: 'SmartBuy AI',
      url: siteUrl,
      logo: {
        '@type': 'ImageObject',
        url: `${siteUrl}/icon-192.png`,
      },
    },
    ...(post.imageUrl ? { image: post.imageUrl } : {}),
  };
}

/**
 * Combine standalone schema objects into one `@graph` document.
 * Each member's own `@context` is dropped (it would duplicate the
 * top-level one); the members themselves are untouched.
 */
export function toJsonLdGraph(
  ...schemas: Array<Record<string, unknown>>
): string {
  const graph = schemas.map(({ '@context': _ignored, ...rest }) => rest);
  return toJsonLd({ '@context': 'https://schema.org', '@graph': graph });
}
