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
