# Search Console + index coverage monitoring (S4#16)

**Scope:** owner-side setup for Google Search Console and Bing
Webmaster Tools. Nothing in this file is automated — verification
tokens and property ownership belong to the site owner, and **no
verification token is invented or stored anywhere in this repo**.
If a step below asks for a token, copy it from the Search Console /
Bing dashboard at the time you do the step.

Live site: `https://shahjahanaibuy-b1zp.vercel.app/`
Sitemap (single file, see `docs/seo.md` §1):

- `https://shahjahanaibuy-b1zp.vercel.app/sitemap.xml`

The 2026-11-10 three-file split (`/sitemap/static.xml`,
`/sitemap/products.xml`, `/sitemap/blog.xml`) was **reverted the
same day** — central verification found all three children
prerender as HTTP 404 on Next 13.5.9 (the metadata-route loader's
`generateSitemaps` id comparison never matches; see
`app/sitemap.ts`). Do NOT submit the three child URLs — they do
not exist. Submit the single `/sitemap.xml` only. If an old
three-child submission exists in Search Console from the split,
remove it and submit `sitemap.xml` instead.

## 1. Google Search Console — verify ownership

1. Go to [Google Search Console](https://search.google.com/search-console)
   and sign in with the Google account that owns the site.
2. Click **Add property** → choose **URL prefix** →
   enter `https://shahjahanaibuy-b1zp.vercel.app/` → Continue.
   (Domain property would need DNS access for the `vercel.app`
   domain, which the owner does not control — URL prefix is the
   right choice here.)
3. Verify with **one** of these methods (pick whichever is easiest):
   - **HTML file** (recommended): download the verification file
     Google offers, place it in `public/` at the repo root, push and
     redeploy, then click Verify. The file must be served at
     `https://shahjahanaibuy-b1zp.vercel.app/<filename>.html`.
     Only the file Google generates for this property works — do not
     reuse a file from another property.
   - **HTML tag**: copy the `<meta name="google-site-verification"
     content="…">` tag Google shows and add it to the `<head>` in
     `app/layout.tsx` (owner or agent edit), push, redeploy, Verify.
     The `content="…"` value comes from Google at that moment — it
     is not in this repo and must never be guessed.
   - **DNS TXT record**: only if the owner controls the domain's DNS.
     Not applicable while the site lives on `vercel.app`.
   - **Google Analytics / Tag Manager**: only if GA4/GTM is already
     verified for the same property (it is not — GA4 is not installed).
4. Keep the verification in place (file or tag). Removing it drops
   the property from Search Console.

## 2. Google Search Console — submit the sitemap

1. In Search Console, open **Indexing → Sitemaps**.
2. Submit `sitemap.xml` (enter the path part only).
3. Wait for the status to turn **Success** (crawling the sitemap
   takes minutes to hours). A **"Couldn't fetch"** status usually
   means the deploy has not finished yet — wait for the Vercel
   deploy, then use **Resubmit**.
4. If a three-child submission (`sitemap/static.xml` etc.) is still
   listed from the reverted 2026-11-10 split, remove it — those
   URLs do not exist (see the note at the top).

## 3. Bing Webmaster Tools

1. Go to [Bing Webmaster Tools](https://www.bing.com/webmasters) and
   sign in with the Microsoft account that owns the site.
2. **Add a site** → enter
   `https://shahjahanaibuy-b1zp.vercel.app/`.
3. Verify — easiest is **Import from Google Search Console** (one
   click, reuses the Google verification). If that is unavailable,
   use Bing's **XML file** or **meta tag** method the same way as
   §1: the file/tag value comes from Bing at that moment.
4. Submit the same single sitemap URL under **Sitemaps** (Bing
   accepts the same path as §2).

## 4. Monthly index-coverage review

Once a month (or after any big content push), check:

1. **Search Console → Indexing → Pages**: look at "Indexed" vs
   "Not indexed". Expected: 11 product pages + 10 blog posts + the
   static pages indexed over the first few weeks (Google indexes
   gradually — new pages can take days to weeks).
2. **Indexing → Sitemaps**: the sitemap **Success**, with
   discovered-URL counts roughly matching the sitemap contents
   (static ~35, products 11, blog 20 — ~66 total). A sitemap that
   stays at 0 discovered URLs means its URLs are not being
   crawled — check `robots.txt` still lists it and the pages
   return 200.
3. **Pages → "Why pages aren't indexed"**: investigate any
   **Crawled — currently not indexed** or **Discovered — currently
   not indexed** entries for product/blog URLs (often thin content
   or crawl budget; do not "fix" by duplicating content).
4. **Enhancements → Breadcrumbs / Products** (if shown): confirm
   the structured data from `docs/seo.md` §2 is picked up with no
   errors. Errors here are fixed in `lib/json-ld.ts` /
   `lib/product-seo.ts`, not in Search Console.
5. **Bing → URL Inspection** for a spot check of one product and
   one blog URL.

## 5. What NOT to do

- Do not submit `sitemap/static.xml`, `sitemap/products.xml` or
  `sitemap/blog.xml` — the three-file split was reverted the day
  it shipped (all three prerendered as 404 on Next 13.5.9); only
  the single `sitemap.xml` exists.
- Do not paste any verification token from this repo or from memory
  — there is none. Tokens only ever come from the Search Console /
  Bing dashboard during the step itself.
- Do not submit sitemaps for `/api/`, `/dashboard/`, `/admin/` or
  `/auth/` — they are disallowed in `robots.txt` and must stay out
  of the index.
