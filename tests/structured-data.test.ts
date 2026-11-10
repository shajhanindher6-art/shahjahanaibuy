import { describe, it, expect } from 'vitest';
import {
  buildArticleJsonLd,
  buildBreadcrumbJsonLd,
  buildFaqJsonLd,
  buildItemListJsonLd,
  buildOrganizationJsonLd,
  buildWebSiteJsonLd,
  toJsonLd,
  toJsonLdGraph,
} from '@/lib/json-ld';

// S4#15 structured data suite (2026-11-10): Organization, WebSite +
// SearchAction, BreadcrumbList, FAQPage, ItemList, Article — pure
// builders over recorded data only, no invented fields.

const SITE = 'https://shahjahanaibuy-b1zp.vercel.app';

describe('toJsonLd', () => {
  it('escapes < so a </script> in data cannot break out of the script tag', () => {
    const out = toJsonLd({ name: '</script><script>alert(1)</script>' });
    expect(out).not.toContain('</script>');
    expect(out).toContain('\\u003c/script>');
    expect(JSON.parse(out).name).toBe(
      '</script><script>alert(1)</script>'
    );
  });
});

describe('toJsonLdGraph', () => {
  it('keeps one @context at the top and strips it from members', () => {
    const doc = JSON.parse(
      toJsonLdGraph(
        buildOrganizationJsonLd(SITE),
        buildBreadcrumbJsonLd(SITE, [
          { name: 'Home', path: '/' },
          { name: 'Blog', path: '/blog' },
        ])
      )
    );
    expect(doc['@context']).toBe('https://schema.org');
    expect(doc['@graph']).toHaveLength(2);
    expect(doc['@graph'][0]['@type']).toBe('Organization');
    expect(doc['@graph'][0]['@context']).toBeUndefined();
    expect(doc['@graph'][1]['@type']).toBe('BreadcrumbList');
    expect(doc['@graph'][1]['@context']).toBeUndefined();
  });
});

describe('buildOrganizationJsonLd', () => {
  it('names the site and points the logo at the real PWA icon', () => {
    const org = buildOrganizationJsonLd(SITE);
    expect(org['@type']).toBe('Organization');
    expect(org.name).toBe('SmartBuy AI');
    expect(org.url).toBe(SITE);
    expect(org.logo).toBe(`${SITE}/icon-192.png`);
    // No invented social profiles: sameAs is omitted entirely.
    expect(org.sameAs).toBeUndefined();
  });
});

describe('buildWebSiteJsonLd', () => {
  it('emits WebSite without SearchAction when no search template is given', () => {
    const site = buildWebSiteJsonLd(SITE);
    expect(site['@type']).toBe('WebSite');
    expect(site.url).toBe(SITE);
    expect(site.potentialAction).toBeUndefined();
  });

  it('emits SearchAction only when the caller supplies a working template', () => {
    const site = buildWebSiteJsonLd(
      SITE,
      `${SITE}/search?q={search_term_string}`
    );
    const action = site.potentialAction as {
      '@type'?: string;
      target?: { urlTemplate?: string };
      'query-input'?: string;
    };
    expect(action['@type']).toBe('SearchAction');
    expect(action.target?.urlTemplate).toBe(
      `${SITE}/search?q={search_term_string}`
    );
    expect(action['query-input']).toBe('required name=search_term_string');
  });
});

describe('buildBreadcrumbJsonLd', () => {
  it('numbers crumbs from 1 and gives URLs to all but the current page', () => {
    const crumbs = buildBreadcrumbJsonLd(SITE, [
      { name: 'Home', path: '/' },
      { name: 'Blog', path: '/blog' },
      { name: 'How to Read a Price History Chart' },
    ]);
    expect(crumbs.itemListElement).toEqual([
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: `${SITE}/`,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Blog',
        item: `${SITE}/blog`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: 'How to Read a Price History Chart',
      },
    ]);
  });
});

describe('buildFaqJsonLd', () => {
  it('maps real Q&A pairs to Question/Answer nodes', () => {
    const faq = buildFaqJsonLd([
      {
        question: 'Are the prices live retailer prices?',
        answer: 'No — prices shown are the catalog figures recorded by SmartBuy.',
      },
    ]);
    expect(faq['@type']).toBe('FAQPage');
    const entity = (
      faq.mainEntity as Array<{
        '@type'?: string;
        name?: string;
        acceptedAnswer?: { text?: string };
      }>
    )[0];
    expect(entity['@type']).toBe('Question');
    expect(entity.name).toBe('Are the prices live retailer prices?');
    expect(entity.acceptedAnswer?.text).toContain('catalog figures');
  });

  it('emits an empty mainEntity for an empty FAQ list', () => {
    expect(buildFaqJsonLd([]).mainEntity).toEqual([]);
  });
});

describe('buildItemListJsonLd', () => {
  it('lists real pages with positions and absolute URLs', () => {
    const list = buildItemListJsonLd(SITE, [
      { name: 'MacBook Air 13', path: '/products/macbook-air-13' },
      { name: 'Logitech MX Master 3S', path: '/products/logitech-mx-master-3s' },
    ]);
    expect(list['@type']).toBe('ItemList');
    expect(list.itemListElement).toEqual([
      {
        '@type': 'ListItem',
        position: 1,
        name: 'MacBook Air 13',
        url: `${SITE}/products/macbook-air-13`,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Logitech MX Master 3S',
        url: `${SITE}/products/logitech-mx-master-3s`,
      },
    ]);
  });
});

describe('buildArticleJsonLd', () => {
  const base = {
    slug: 'how-to-read-price-history-chart-laptop',
    title: 'How to Read a Price History Chart Before You Buy a Laptop',
    excerpt: 'A laptop price today means little on its own.',
    datePublished: '2026-11-06',
  };

  it('emits Article with headline, dates and publisher', () => {
    const article = buildArticleJsonLd(SITE, base);
    expect(article['@type']).toBe('Article');
    expect(article.headline).toBe(base.title);
    expect(article.description).toBe(base.excerpt);
    expect(article.url).toBe(`${SITE}/blog/${base.slug}`);
    expect(article.datePublished).toBe('2026-11-06');
    expect(article.dateModified).toBeUndefined();
    const publisher = article.publisher as { name?: string };
    expect(publisher.name).toBe('SmartBuy AI');
  });

  it('falls back to the Organization as author when no name is recorded', () => {
    const article = buildArticleJsonLd(SITE, base);
    const author = article.author as { '@type'?: string; name?: string };
    expect(author['@type']).toBe('Organization');
    expect(author.name).toBe('SmartBuy AI');
  });

  it('uses a Person author and dateModified when both are recorded', () => {
    const article = buildArticleJsonLd(SITE, {
      ...base,
      authorName: 'SmartBuy Editorial',
      lastUpdated: '2026-11-09',
    });
    const author = article.author as { '@type'?: string; name?: string };
    expect(author['@type']).toBe('Person');
    expect(author.name).toBe('SmartBuy Editorial');
    expect(article.dateModified).toBe('2026-11-09');
  });

  it('omits image when the post has none', () => {
    expect(buildArticleJsonLd(SITE, base).image).toBeUndefined();
  });
});
