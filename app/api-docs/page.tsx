/**
 * Public API documentation page (Section 4, item 18).
 *
 * Static page describing the read-only public API: endpoints,
 * authentication (optional API key), rate limits, and examples.
 * Keys are created via POST /api/v1/public/keys while signed in;
 * a dedicated key-management UI in the dashboard is wave 2.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/layout/site-header';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { SiteFooter } from '@/components/layout/site-footer';
import { ANONYMOUS_DAILY_QUOTA, API_QUOTAS } from '@/lib/api-quota';

export const metadata: Metadata = {
  title: 'API Docs — SmartBuy AI',
  description:
    'SmartBuy AI public read-only API: products, recorded prices and deals. Free, key-optional, rate-limited.',
};

const BASE_URL = 'https://shahjahanaibuy-b1zp.vercel.app';

const ENDPOINTS: Array<{
  method: string;
  path: string;
  description: string;
}> = [
  {
    method: 'GET',
    path: '/api/v1/public/products',
    description: 'List products (paginated; search, category, brand filters).',
  },
  {
    method: 'GET',
    path: '/api/v1/public/products/[slug]',
    description: 'One product plus its latest recorded price.',
  },
  {
    method: 'GET',
    path: '/api/v1/public/prices?product_id=<uuid> or ?slug=<slug>',
    description: 'Recent recorded price history for one product.',
  },
  {
    method: 'GET',
    path: '/api/v1/public/deals',
    description: 'Active deals, soonest-ending first.',
  },
  {
    method: 'GET',
    path: '/api/v1/predictions/accuracy',
    description: 'Prediction accuracy summary (honest “not enough history yet” until 20 outcomes resolve).',
  },
  {
    method: 'GET',
    path: '/api/v1/monitoring/uptime',
    description: 'Uptime % from recorded checks + open incidents (same data as /status).',
  },
  {
    method: 'GET',
    path: '/api/v1/monitoring/incidents',
    description: 'Incident history.',
  },
];

export default function ApiDocsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 14: page-level JSON-LD (WebPage + BreadcrumbList). */}
      <PageJsonLd
        name="API Docs"
        description="SmartBuy AI public read-only API: products, recorded prices and deals. Free, key-optional, rate-limited."
        path="/api-docs"
        crumbs={[ { name: "Home", path: "/" }, { name: "API Docs" } ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-3xl font-bold">Public API</h1>
          <p className="mt-4 text-muted-foreground">
            A read-only API for products, recorded prices, deals, prediction accuracy and
            uptime. Free to use — no sign-up required for the anonymous tier.
          </p>

          <h2 className="mt-8 text-xl font-semibold">Authentication</h2>
          <p className="mt-3 text-muted-foreground">
            No key is needed for casual use (30 requests/minute per IP). Send an API key in
            the <code className="rounded bg-muted px-1">x-api-key</code> header to raise the
            limit to 120 requests/minute. Keys are created while signed in via{' '}
            <code className="rounded bg-muted px-1">POST /api/v1/public/keys</code> — the full
            key is shown exactly once at creation, so store it immediately. Only the SHA-256
            hash is stored; a lost key cannot be recovered, only revoked and replaced.
          </p>

          <h2 className="mt-8 text-xl font-semibold">Rate limits</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
            <li>Anonymous: 30 requests/minute per IP.</li>
            <li>With a valid API key: 120 requests/minute per key.</li>
            <li>Over the limit: HTTP 429 with a reset time. Do not retry in a tight loop.</li>
          </ul>
          <p className="mt-3 text-muted-foreground">
            The per-minute limit is enforced per endpoint as well as per caller, and the
            per-endpoint limit varies: most read endpoints allow 120 requests/minute per IP
            (for example <code className="rounded bg-muted px-1">GET /api/v1/ai-summary/[productId]</code>{' '}
            and <code className="rounded bg-muted px-1">GET /api/v1/community-deals</code>),
            while write endpoints are stricter — submitting a community deal and creating a
            referral link each allow 30 requests/minute per IP. The limit that applies is
            the one the endpoint states when it answers 429.
          </p>

          <h3 className="mt-6 text-lg font-semibold">Rate-limit headers — what is (and is not) sent</h3>
          <p className="mt-3 text-muted-foreground">
            The API does <strong>not</strong> send <code className="rounded bg-muted px-1">Retry-After</code>{' '}
            or <code className="rounded bg-muted px-1">X-RateLimit-*</code> headers today — no
            response carries them, so do not rely on headers to learn the limit. The reset
            time is in the JSON error body instead: every 429 body carries{' '}
            <code className="rounded bg-muted px-1">error.details.resetAt</code> (ISO 8601,
            the UTC midnight ending the current quota day for daily quotas, or the end of
            the current minute window for per-minute limits). Wait until that time before
            retrying.
          </p>

          {/* Section 12, chunk C — daily quotas. These numbers are
              the live enforcement in lib/api-quota.ts (imported
              above, not copied), so this table cannot drift from
              what the API actually enforces. The per-minute limits
              above still apply on top of the daily cap. A key's tier
              comes from its owner's subscription (active paid
              subscription required for a paid quota; anything else
              stays on the free quota). */}
          <h2 className="mt-8 text-xl font-semibold">Daily quotas</h2>
          <p className="mt-3 text-muted-foreground">
            On top of the per-minute limits, every caller has a daily quota (requests per UTC
            day). Over the daily quota the API answers HTTP 429 naming your tier, the limit, the
            reset time (UTC midnight) and the next tier up.
          </p>
          <table className="mt-4 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 pr-4 font-semibold">Caller</th>
                <th className="py-2 font-semibold">Requests / day</th>
              </tr>
            </thead>
            <tbody className="text-muted-foreground">
              <tr className="border-b">
                <td className="py-2 pr-4">Anonymous (no key, per IP)</td>
                <td className="py-2">{ANONYMOUS_DAILY_QUOTA.toLocaleString('en-US')}</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4">Free tier key</td>
                <td className="py-2">{API_QUOTAS.free.toLocaleString('en-US')}</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4">Premium tier key</td>
                <td className="py-2">{API_QUOTAS.premium.toLocaleString('en-US')}</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4">Family tier key</td>
                <td className="py-2">{API_QUOTAS.family.toLocaleString('en-US')}</td>
              </tr>
              <tr>
                <td className="py-2 pr-4">Team tier key</td>
                <td className="py-2">{API_QUOTAS.team.toLocaleString('en-US')}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 text-sm text-muted-foreground">
            Paid tiers exist, but payments aren&apos;t live yet (Stripe is in test mode), so a
            paid tier can&apos;t be purchased today — see{' '}
            <Link href="/pricing" className="font-medium underline underline-offset-4">
              Pricing
            </Link>
            .
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            Quota state is kept in memory (see lib/api-quota.ts): the counter resets when the
            server instance restarts and is not shared across instances, so a burst spread
            across instances can briefly exceed the daily cap. The durable counter table is
            defined but its migration has not been applied — the in-memory behaviour above is
            what the API actually does today.
          </p>

          <h3 className="mt-6 text-lg font-semibold">What a quota 429 looks like</h3>
          <p className="mt-3 text-muted-foreground">
            A daily-quota breach answers 429 with the tier, the limit, how many requests you
            have used, the reset time, the next tier up (when one exists), and the pricing
            page — all in the body, not in headers:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-muted p-4 text-sm">
            {`HTTP/1.1 429 Too Many Requests
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "API quota exceeded for the Free tier (1,000 requests/day). Upgrade to Premium for 10,000 requests/day. See /pricing. Quota resets at 2026-11-12T00:00:00.000Z.",
    "details": {
      "tier": "free",
      "limit": 1000,
      "used": 1001,
      "resetAt": "2026-11-12T00:00:00.000Z",
      "upgradeTier": "premium",
      "billingUrl": "/pricing"
    }
  }
}`}
          </pre>
          <p className="mt-3 text-sm text-muted-foreground">
            Anonymous callers get the same shape with a per-IP message instead (create a free
            API key for 1,000 requests/day). Every request counts toward the quota — including
            requests that end up over it — and a key whose owner has no active paid
            subscription stays on the free quota.
          </p>

          <h2 className="mt-8 text-xl font-semibold">Response format</h2>
          <p className="mt-3 text-muted-foreground">
            Every response uses the same envelope. Success is{' '}
            <code className="rounded bg-muted px-1">{'{ "success": true, "data": … }'}</code>{' '}
            (with an optional <code className="rounded bg-muted px-1">meta</code> object for
            notices such as the demo-data flag); errors are{' '}
            <code className="rounded bg-muted px-1">{'{ "success": false, "error": { "code", "message", "details"? } }'}</code>
            . Check <code className="rounded bg-muted px-1">success</code> first — the HTTP
            status alone does not tell you whether a body is data or an error.
          </p>

          <h2 className="mt-8 text-xl font-semibold">Errors</h2>
          <p className="mt-3 text-muted-foreground">
            All error codes, from the response helpers in lib/api/responses.ts. The message is
            human-readable; the code is the stable value to switch on.
          </p>
          <table className="mt-4 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 pr-4 font-semibold">HTTP status</th>
                <th className="py-2 pr-4 font-semibold">Code</th>
                <th className="py-2 font-semibold">When it happens</th>
              </tr>
            </thead>
            <tbody className="text-muted-foreground">
              <tr className="border-b">
                <td className="py-2 pr-4">400</td>
                <td className="py-2 pr-4 font-mono">BAD_REQUEST</td>
                <td className="py-2">The request is malformed (for example, a missing required field).</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4">401</td>
                <td className="py-2 pr-4 font-mono">UNAUTHORIZED</td>
                <td className="py-2">Sign-in is required for this endpoint.</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4">403</td>
                <td className="py-2 pr-4 font-mono">FORBIDDEN</td>
                <td className="py-2">Signed in, but not allowed (for example, admin-only endpoints).</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4">404</td>
                <td className="py-2 pr-4 font-mono">NOT_FOUND</td>
                <td className="py-2">The product, deal, or resource does not exist.</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4">409</td>
                <td className="py-2 pr-4 font-mono">CONFLICT</td>
                <td className="py-2">The request conflicts with current state (for example, a duplicate).</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4">422</td>
                <td className="py-2 pr-4 font-mono">VALIDATION_ERROR</td>
                <td className="py-2">The input failed validation — the message names the problem.</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4">429</td>
                <td className="py-2 pr-4 font-mono">RATE_LIMITED</td>
                <td className="py-2">Per-minute limit or daily quota exceeded — see the reset time in error.details.resetAt.</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4">500</td>
                <td className="py-2 pr-4 font-mono">INTERNAL_ERROR</td>
                <td className="py-2">Something failed on the server. Retry later; the detail is not exposed.</td>
              </tr>
              <tr>
                <td className="py-2 pr-4">503</td>
                <td className="py-2 pr-4 font-mono">SERVICE_UNAVAILABLE</td>
                <td className="py-2">The feature is not set up yet (for example, a database table the owner still needs to create).</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 text-sm text-muted-foreground">
            Example error body (unknown product):
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-muted p-4 text-sm">
            {`{
  "success": false,
  "error": { "code": "NOT_FOUND", "message": "Product not found" }
}`}
          </pre>

          <h2 className="mt-8 text-xl font-semibold">Endpoints</h2>
          <p className="mt-3 text-sm text-muted-foreground">Base URL: {BASE_URL}</p>
          <ul className="mt-4 space-y-4">
            {ENDPOINTS.map((e) => (
              <li key={e.path} className="rounded-lg border p-4">
                <p className="font-mono text-sm">
                  <span className="font-semibold">{e.method}</span> {e.path}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{e.description}</p>
              </li>
            ))}
          </ul>

          <h2 className="mt-8 text-xl font-semibold">Example</h2>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-muted p-4 text-sm">
            {`curl "${BASE_URL}/api/v1/public/products?pageSize=5" \\
  -H "x-api-key: sbk_live_your_key_here"`}
          </pre>
          <p className="mt-3 text-muted-foreground">
            A products-list response — the data is the catalog page, and{' '}
            <code className="rounded bg-muted px-1">meta</code> carries the pagination plus the
            data notice (prices are demo/seed data, not live retailer prices):
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-muted p-4 text-sm">
            {`{
  "success": true,
  "data": [ { "id": "…", "name": "MacBook Air 13", "slug": "macbook-air-13", "brand": "Apple", "category": "laptops", "…" : "…" } ],
  "meta": {
    "page": 1,
    "pageSize": 5,
    "total": 10,
    "totalPages": 2,
    "dataNotice": "Catalog data only. Prices shown on SmartBuy AI are demo/seed data, not live retailer prices."
  }
}`}
          </pre>
          <p className="mt-3 text-muted-foreground">
            Price history for one product (by slug, or by{' '}
            <code className="rounded bg-muted px-1">product_id</code>):
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-muted p-4 text-sm">
            {`curl "${BASE_URL}/api/v1/public/prices?slug=macbook-air-13"

{
  "success": true,
  "data": {
    "productId": "…",
    "prices": [ { "price": 999, "recordedAt": "2026-11-10T…" } ],
    "source": "recorded",
    "dataNotice": "Recorded price history only — these are demo/seed prices, not live retailer prices."
  }
}`}
          </pre>
          <p className="mt-3 text-sm text-muted-foreground">
            List endpoints cap <code className="rounded bg-muted px-1">pageSize</code> at 100
            (default 20). The deals endpoint returns active deals soonest-ending first; the
            predictions-accuracy endpoint reports &ldquo;not enough history yet&rdquo; until 20
            predictions have resolved.
          </p>

          <h2 className="mt-8 text-xl font-semibold">Data honesty</h2>
          <p className="mt-3 text-muted-foreground">
            Prices in this API are recorded demo/seed data, not live retailer prices — every
            price response says so and carries its <code className="rounded bg-muted px-1">recordedAt</code>{' '}
            timestamp. Prediction accuracy is published only after 20 predictions have
            resolved; before that the endpoint reports “not enough history yet”. Uptime is
            computed from recorded checks only and is absent until checks accrue.
          </p>
          <p className="mt-3 text-muted-foreground">
            Paid tiers exist — Premium, Family and Team keys get the higher daily quotas in the
            table above — but payments aren&apos;t live yet, so a paid tier can&apos;t be
            purchased today. The API is read-only: write access is not offered. If you build
            something with this API, please respect the rate limits and link back to SmartBuy AI.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
