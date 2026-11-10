# SEO — sitemap, structured data, blog metadata

**Scope:** S2#13 SEO leftovers + S4#15 structured data suite + S4#16 Search
Console (implemented 2026-11-10). Live site:
`https://shahjahanaibuy-b1zp.vercel.app/`.

## 1. Single sitemap

`app/sitemap.ts` serves one combined `/sitemap.xml` with three
sections inside it:

| Section | Contents | `lastModified` source |
|---|---|---|
| Static pages | 34 public static pages (incl. `/gifts`, `/bundles`, `/scan`, `/privacy`, `/terms`, `/cookies`, `/extension`, `/track`, `/p2p-match`) + `/blog` | `/blog`: latest post's `datePublished` (real). All other static pages: **omitted** — no per-page modification date is recorded anywhere. |
| Products | Product pages from the DB (`slug`, `updated_at`, max 500) | Real `updated_at`; omitted when null. |
| Blog | All blog posts from `lib/blog/posts.ts` | Real `datePublished`. |

### ⚠️ The three-file split was reverted — read this before "fixing" it

The batch first split this into `/sitemap/static.xml`,
`/sitemap/products.xml` and `/sitemap/blog.xml` via
`generateSitemaps()`. Central verification (2026-11-10) found all
three children prerender as **HTTP 404**: in Next 13.5.9 the
metadata-route loader's GET compares `item.id.toString() ===
targetId` where `targetId = __metadata_id__[0]`, but
`generateStaticParams` produces `__metadata_id__` values with the
`.xml` suffix appended (`'static.xml'` vs id `'static'`), so no id
ever matches and the loader returns 404 for every child (see
`node_modules/next/dist/build/webpack/loaders/next-metadata-route-loader.js`,
`getDynamicSiteMapRouteCode`). The split was therefore reverted the
same day and the single `/sitemap.xml` restored (the shape the site
served before the batch, verified 32/32 URLs live). Do NOT re-add
`generateSitemaps` without first proving a child URL returns 200
from a production build. A split can be revisited after a Next.js
upgrade, or with hand-written route files instead of the metadata
convention. `app/robots.ts` lists the single `/sitemap.xml`, and the
owner submits that one URL in Search Console (see
`docs/search-console.md`).

### `lastModified` policy — real dates only

The old sitemap stamped `new Date()` on every static page, so every
generation falsely claimed all pages were just modified. That is fixed:
a `lastModified` is emitted only when a real date exists in the data
source, otherwise the field is omitted (valid — crawlers treat it as
"unknown"). Never reintroduce `new Date()` here.

### Note — no sitemap index on Next 13.5.9

Next 13.5.9 does not auto-generate a `<sitemapindex>` (verified in
the installed framework code: `node_modules/next/dist/build/index.js`
remaps the route, and the sitemap resolver only ever emits
`<urlset>`, never `<sitemapindex>`). That is fine here: a single
`/sitemap.xml` needs no index (the file is well under the 50,000-URL
limit), and `app/robots.ts` points crawlers at it directly. If a
literal `<sitemapindex>` is ever wanted, it needs a hand-written
route file (`app/sitemap.xml/route.ts`).

## 2. Structured data (S4#15)

Builders live in `lib/json-ld.ts` (pure, tested in
`tests/structured-data.test.ts`). `toJsonLd` still escapes `<` as
`\u003c` so a `</script>` in data can never break out of the script
tag; `toJsonLdGraph` combines standalone schemas into one `@graph`
document for pages that emit a single script tag.

| Schema | Where it is emitted | Status |
|---|---|---|
| `Organization` | — (builder ready) | **Wave 2** — belongs in `app/layout.tsx`, which this batch does not own. Wire `buildOrganizationJsonLd(appConfig.url)` into the layout's existing JSON-LD script. |
| `WebSite` | — (builder ready) | **Wave 2** — same layout wiring as Organization. |
| `WebSite` + `SearchAction` | — (builder supports it) | **Blocked** — `/search` does not read `?q=` yet (Section 2, item 30g, open user decision). A `SearchAction` pointing at a page that ignores the query would be misleading, so nothing emits one today. When `/search` gains `?q=` support, wire `${siteUrl}/search?q={search_term_string}`. |
| `BreadcrumbList` | Product pages (`lib/product-seo.ts`, Home → product) and blog articles (`app/blog/[slug]/page.tsx`, Home → Blog → article) | **Live in this batch.** No `/products` index page exists, so the product breadcrumb has no intermediate crumb. |
| `Product` (+ `Offer`, `AggregateRating`) | Product pages via `lib/product-seo.ts` | **Live**, extended in this batch: now a `@graph` with the breadcrumb. |
| `Article` | Blog articles (`app/blog/[slug]/page.tsx`) | **Live in this batch.** Author is a `Person` only when a name is recorded, otherwise the publishing `Organization`; `dateModified` only when a real update date exists. |
| `FAQPage` | — (builder ready) | **No source yet** — there is no FAQ content source (no FAQ page data, no Q&A records). Wire `buildFaqJsonLd` when a real FAQ page exists; never invent questions/answers. |
| `ItemList` | — (builder ready) | **Wave 2** — belongs on `/search` results and `/blog` listing, which this batch does not own. Callers must pass only real page URLs. |

## 3. Blog metadata (S2#13)

`app/blog/[slug]/page.tsx` `generateMetadata` now emits, per post:
canonical URL, Open Graph `type: 'article'` with `locale: 'en_US'`,
`publishedTime` (from `datePublished`) and `modifiedTime` (only when
`lastUpdated` is recorded), and Twitter card/title/description.
Product metadata (`lib/product-seo.ts`) also gained `og:locale:
'en_US'`.

Author display (S4#17, partial): the article page shows "By
{author}" and "Last updated {date}" under the byline — but only when
`post.author` / `post.lastUpdated` exist. Both reads are defensive
(`?? null`); the fields are being added to the `Post` type by another
worker. No author-bio paragraph is rendered: no bio text exists in
the data, and inventing one would be fake content. A full bio needs an
`authorBio` field on `Post` (wave 2 / other worker) plus the owner's
real bio text.

## 4. Honest omissions — do not "fix" these by inventing data

- **`twitter:site` / `twitter:creator`** (product + blog metadata):
  omitted everywhere. They need a real `@handle` and SmartBuy AI has
  no verified X/Twitter handle on record (repo-wide grep: none).
  Owner step: once a real handle exists, add it in
  `lib/product-seo.ts`, `app/blog/[slug]/page.tsx` and the root
  layout's metadata.
- **`Offer.priceValidUntil`**: the builder supports it
  (`ProductSeoData.priceValidUntil`), but it is `null` today because
  merchant data carries no validity window — and seed prices are demo
  figures, so claiming they hold until a date would misrepresent
  them. Populate it in `lib/product-seo-server.ts` only when a live
  price source with a real validity window arrives.
- **`sameAs` on Organization**: omitted — no verified social profiles
  on record.
- **hreflang / localized routes**: out of scope for this batch. The
  site has 8 UI languages but language switching is client-side,
  `<html lang="en">` is hardcoded and no localized routes exist, so
  there is nothing real to declare. That needs localized routes first
  (separate work, layout + routing owners).
- **Per-post OG images**: none exist; posts fall back to the site-wide
  `app/opengraph-image.tsx`. Never invent a post image.

## 5. Heading hierarchy audit

Files owned by this batch: `app/blog/[slug]/page.tsx` is correct —
one `h1` (post title), `h2` section headings from content blocks, no
skipped levels. `app/sitemap.ts`, `app/robots.ts`, `lib/json-ld.ts`,
`lib/product-seo.ts`, `lib/product-seo-server.ts` render no headings.

Files this batch does **not** own (wave 2, with evidence from
2026-11-10 grep):

| File | Finding |
|---|---|
| `components/products/product-detail-client.tsx` | **Two `h1`s**, four `h3` section headings ("Decision Suite", "Hardware Endurance & Sustainability", "Anti-Trap Checks", "Global Readiness") and one `h4` — **zero `h2`s**. Sections must become `h2` and the page must have exactly one `h1`. |
| `app/compare/page.tsx` | One `h1`, four `h3`s, **zero `h2`s** — `h3`s skip a level. |
| `app/page.tsx` (homepage) | Five `h2`s + one `h3`; the `h1` was not found in the page file itself (may live in a hero component) — verify the page renders exactly one `h1` before calling it done. |
| `app/search/page.tsx` | `h1` + `h2`s + `h3`s present — verify nesting order (each `h3` under an `h2`). |
| `app/layout.tsx` | Add `og:locale: 'en_US'` to the root Open Graph metadata, and `twitter:site`/`creator` once a real handle exists (see §4). |

## 6. How to verify (after deploy)

- `curl /robots.txt` — must list the single `/sitemap.xml` URL.
- `curl /sitemap.xml` — valid `<urlset>` (~66 URLs: 35 static +
  11 products + 20 blog posts with live data); no `<lastmod>` with
  today's date on static pages; blog `<lastmod>` values are real
  publish dates; product `<lastmod>` values are real `updated_at`.
- `curl /sitemap/static.xml` — expected 404: the three-file split
  was reverted (see §1); this is by design, not a bug.
- Product page view-source: one `application/ld+json` script with
  `@graph` containing `Product` + `BreadcrumbList`; validate at
  Google's Rich Results Test.
- Blog article view-source: `@graph` with `Article` +
  `BreadcrumbList`; `dateModified` absent until a post records an
  update.
