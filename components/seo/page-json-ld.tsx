'use client';

/**
 * Per-page JSON-LD (Section 16, item 14 + item 17).
 *
 * 29 public routes had no page-level `application/ld+json` at all —
 * only the site-wide Organization / WebSite / WebApplication block
 * in app/layout.tsx. Every page below wires one of these lines:
 *
 *   <PageJsonLd name="…" description="…" path="/compare"
 *     crumbs={[{ name: 'Home', path: '/' }, { name: 'Compare' }]} />
 *
 * Emits a single @graph script: a WebPage (name + description + URL
 * + isPartOf WebSite), plus a BreadcrumbList when crumbs are passed,
 * plus an ItemList when items are passed (index pages list the real
 * URLs on the page — events, creators, live sessions, /find terms).
 * Only real pages are ever listed; nothing here invents a rating, a
 * price, an author, or a date.
 *
 * A client component on purpose: several of the 29 pages are client
 * components ('use client'), which cannot import a server component.
 * The script tag is still server-rendered (client components SSR),
 * so crawlers see it in the HTML.
 */

import { appConfig } from '@/lib/config/app';
import {
  buildBreadcrumbJsonLd,
  buildItemListJsonLd,
  buildWebPageJsonLd,
  toJsonLdGraph,
  type BreadcrumbCrumb,
  type ItemListEntry,
} from '@/lib/json-ld';

interface PageJsonLdProps {
  /** Page name, as shown in the h1 (or the metadata title without the brand suffix). */
  name: string;
  /** One-sentence description, matching the page's metadata description when it has one. */
  description?: string | null;
  /** Path from the site root (e.g. '/compare'). */
  path: string;
  /** Breadcrumb trail; the last crumb (current page) has no path. Omit when the page has no trail. */
  crumbs?: BreadcrumbCrumb[];
  /** Real page URLs listed on this page (index pages only). */
  items?: ItemListEntry[];
}

export function PageJsonLd({ name, description, path, crumbs, items }: PageJsonLdProps) {
  const schemas: Array<Record<string, unknown>> = [
    buildWebPageJsonLd(appConfig.url, { name, description, path }),
  ];
  if (crumbs && crumbs.length > 0) {
    schemas.push(buildBreadcrumbJsonLd(appConfig.url, crumbs));
  }
  if (items && items.length > 0) {
    schemas.push(buildItemListJsonLd(appConfig.url, items));
  }
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: toJsonLdGraph(...schemas) }}
    />
  );
}
