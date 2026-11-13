/**
 * Admin product list (Section 20, §12 #69) — /admin/products.
 *
 * All products, any status — pending / rejected rows are visible
 * here, unlike the public catalog. Search + status + verification
 * filters via GET params. Each row shows the transparent data
 * quality score (services/product-quality-score.ts) with its
 * missing fields, the verification status, and the last update —
 * the score is computed on read from stored fields, so it is
 * always current. Guard: /admin/layout.tsx redirects non-admins
 * server-side before this page renders.
 *
 * All copy is literal English — no i18n keys are added for admin
 * surfaces.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  getProductQualityContexts,
  listAdminProducts,
} from '@/services/admin-products';
import {
  DATA_QUALITY_SCORE_LABEL,
  computeProductQualityScore,
} from '@/services/product-quality-score';
import { priceVerificationLabel } from '@/services/price-verification';
import { formatLastChecked } from '@/lib/price-freshness';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Products — Admin — SmartBuy AI',
  description: 'All catalog products: search, filter, edit, and delete. Admin only.',
  robots: {
    index: false,
    follow: false,
  },
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; verification?: string; page?: string };
}) {
  const service = createSupabaseServiceClient();

  if (!service) {
    return (
      <main className="container mx-auto max-w-6xl px-4 py-12">
        <h1 className="text-3xl font-bold">Products</h1>
        <p className="mt-4 text-muted-foreground">
          The service-role key is not configured, so products cannot be
          read. Set SUPABASE_SERVICE_ROLE_KEY in the hosting dashboard.
        </p>
      </main>
    );
  }

  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);
  const result = await listAdminProducts(service, {
    search: searchParams.q,
    status: searchParams.status,
    verification: searchParams.verification,
    page,
    pageSize: 20,
  });
  const contexts = await getProductQualityContexts(
    service,
    result.products.map((p) => p.id)
  );

  return (
    <main className="container mx-auto max-w-6xl px-4 py-12">
      <h1 className="text-3xl font-bold">Products</h1>
      <p className="mt-2 text-muted-foreground">
        {result.total} product(s) in the catalog, newest first — every
        status, including pending and rejected rows the public catalog
        never shows.
      </p>
      <p className="mt-2 text-sm">
        <Link href="/admin/products/review" className="underline">
          Review queues — duplicates, missing specs, images, price history
        </Link>
        {' · '}
        <Link href="/admin/ingestion-failures" className="underline">
          Ingestion failures
        </Link>
      </p>

      {result.columnsMissing ? (
        <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950">
          The status and price-verification columns do not exist yet
          (migration 045 not applied): status and verification filters
          are not applied, and every product reads as published /
          unverified. Apply migration 045 in the Supabase SQL Editor
          to enable them.
        </p>
      ) : null}
      {result.error ? (
        <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950">
          Products could not be read: {result.error}
        </p>
      ) : null}

      <form method="get" className="mt-6 flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="admin-products-q">Search products</label>
        <input
          id="admin-products-q"
          name="q"
          defaultValue={searchParams.q ?? ''}
          placeholder="Search name, brand, category…"
          className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
        />
        <label className="sr-only" htmlFor="admin-products-status">Filter by status</label>
        <select
          id="admin-products-status"
          name="status"
          defaultValue={searchParams.status ?? ''}
          className="rounded-lg border px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          <option value="pending">pending</option>
          <option value="published">published</option>
          <option value="rejected">rejected</option>
        </select>
        <label className="sr-only" htmlFor="admin-products-verification">Filter by verification</label>
        <select
          id="admin-products-verification"
          name="verification"
          defaultValue={searchParams.verification ?? ''}
          className="rounded-lg border px-3 py-2 text-sm"
        >
          <option value="">All verification states</option>
          <option value="verified">verified</option>
          <option value="unverified">unverified</option>
          <option value="stale">stale</option>
        </select>
        <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white">
          Filter
        </button>
      </form>

      {result.products.length === 0 ? (
        <div className="mt-6 rounded-lg border p-6">
          <p className="font-medium">No products match these filters.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {result.total === 0
              ? 'The catalog is empty. Products arrive through CSV intake (/admin/intake) or the eBay import (/admin/intake/ebay).'
              : 'Try clearing the search or the filters.'}
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {result.products.map((product) => {
            const score = computeProductQualityScore(
              {
                name: product.name,
                slug: product.slug,
                brand: product.brand,
                category: product.category,
                description: product.description,
                imageUrl: product.imageUrl,
                gtin: product.gtin,
                priceVerificationStatus: product.priceVerificationStatus,
                priceVerifiedAt: product.priceVerifiedAt,
                dataFreshness: product.dataFreshness,
                updatedAt: product.updatedAt,
              },
              contexts.get(product.id) ?? {}
            );
            const verification = priceVerificationLabel(
              product.priceVerificationStatus,
              formatLastChecked(product.priceVerifiedAt)
            );
            return (
              <section key={product.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      <Link href={`/admin/products/${product.id}`} className="underline">
                        {product.name}
                      </Link>
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {product.brand ?? 'No brand'} · {product.category ?? 'No category'} ·{' '}
                      {product.slug}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
                      {product.status}
                    </span>
                    <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
                      {verification.shortText}
                    </span>
                  </div>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {DATA_QUALITY_SCORE_LABEL}: <strong>{score.score} / 100</strong> ({score.grade})
                  {score.missingFields.length > 0
                    ? ` — missing: ${score.missingFields.join(', ')}`
                    : ' — nothing missing'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Last updated {formatDateTime(product.updatedAt)}
                  {score.priceAgeDays !== null
                    ? ` · price last checked ${score.priceAgeDays} day(s) ago`
                    : ''}
                </p>
              </section>
            );
          })}
        </div>
      )}

      {result.totalPages > 1 ? (
        <nav aria-label="Product pages" className="mt-6 flex flex-wrap gap-2">
          {page > 1 ? (
            <Link
              href={`/admin/products?page=${page - 1}${searchParams.q ? `&q=${encodeURIComponent(searchParams.q)}` : ''}${searchParams.status ? `&status=${searchParams.status}` : ''}${searchParams.verification ? `&verification=${searchParams.verification}` : ''}`}
              className="rounded-lg border px-4 py-2 text-sm font-medium"
            >
              Previous page
            </Link>
          ) : null}
          <span className="px-2 py-2 text-sm text-muted-foreground">
            Page {result.page} of {result.totalPages}
          </span>
          {page < result.totalPages ? (
            <Link
              href={`/admin/products?page=${page + 1}${searchParams.q ? `&q=${encodeURIComponent(searchParams.q)}` : ''}${searchParams.status ? `&status=${searchParams.status}` : ''}${searchParams.verification ? `&verification=${searchParams.verification}` : ''}`}
              className="rounded-lg border px-4 py-2 text-sm font-medium"
            >
              Next page
            </Link>
          ) : null}
        </nav>
      ) : null}
    </main>
  );
}
