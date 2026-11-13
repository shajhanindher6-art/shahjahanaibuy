/**
 * Admin product edit page (Section 20, §12 #69) — /admin/products/[id].
 *
 * Server component: loads the product, its data-quality breakdown,
 * its specs, and its recent price history, then renders the edit
 * form (components/admin/product-edit-form.tsx). Guard:
 * /admin/layout.tsx redirects non-admins server-side. All copy is
 * literal English — no i18n keys are added for admin surfaces.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  getAdminProductById,
  getAdminProductPriceHistory,
  getProductQualityContexts,
} from '@/services/admin-products';
import { getProductAttributes } from '@/services/products';
import {
  DATA_QUALITY_SCORE_LABEL,
  computeProductQualityScore,
} from '@/services/product-quality-score';
import { priceVerificationLabel } from '@/services/price-verification';
import { formatLastChecked } from '@/lib/price-freshness';
import { ProductEditForm } from '@/components/admin/product-edit-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Edit product — Admin — SmartBuy AI',
  description: 'Edit a catalog product. Admin only.',
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

export default async function AdminProductEditPage({
  params,
}: {
  params: { id: string };
}) {
  const service = createSupabaseServiceClient();

  if (!service) {
    return (
      <main className="container mx-auto max-w-4xl px-4 py-12">
        <h1 className="text-3xl font-bold">Edit product</h1>
        <p className="mt-4 text-muted-foreground">
          The service-role key is not configured, so the product cannot
          be read. Set SUPABASE_SERVICE_ROLE_KEY in the hosting dashboard.
        </p>
      </main>
    );
  }

  const { product, columnsMissing } = await getAdminProductById(service, params.id);
  if (!product) notFound();

  const contexts = await getProductQualityContexts(service, [product.id]);
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
  const attributes = await getProductAttributes(service, product.id);
  const history = await getAdminProductPriceHistory(service, product.id, 10);

  return (
    <main className="container mx-auto max-w-4xl px-4 py-12">
      <p className="text-sm">
        <Link href="/admin/products" className="underline">
          ← All products
        </Link>
      </p>
      <h1 className="mt-2 text-3xl font-bold">Edit product</h1>
      <p className="mt-2 text-muted-foreground">
        {product.name} · {product.slug}
      </p>

      <section aria-label="Data quality" className="mt-6 rounded-lg border p-6">
        <p className="text-sm text-muted-foreground">{DATA_QUALITY_SCORE_LABEL}</p>
        <p className="mt-1 text-4xl font-bold">{score.score} / 100</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Grade: {score.grade}. This is a data quality score — how
          complete, verifiable, and fresh this product&apos;s record is
          — never a judgement of the product itself.
        </p>
        <ul className="mt-4 space-y-1 text-sm">
          {score.dimensions.map((d) => (
            <li key={d.key}>
              {d.label}: {d.score} / 100
              {d.missingFields.length > 0 ? ` — missing: ${d.missingFields.join(', ')}` : ''}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted-foreground">
          Verification: {verification.text}. Last updated{' '}
          {formatDateTime(product.updatedAt)}.
        </p>
      </section>

      <ProductEditForm
        productId={product.id}
        slug={product.slug}
        statusEditable={!columnsMissing}
        initial={{
          name: product.name,
          description: product.description ?? '',
          brand: product.brand ?? '',
          category: product.category ?? '',
          image_url: product.imageUrl ?? '',
          gtin: product.gtin ?? '',
          status: product.status,
        }}
      />

      <section aria-label="Specs" className="mt-10">
        <h2 className="text-xl font-semibold">Specs ({attributes.length})</h2>
        {attributes.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No specs stored for this product. Spec editing is not
            available in this admin UI yet — specs arrive through
            intake, and there is no admin spec write API to call.
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {attributes.map((attr) => (
              <li key={attr.id}>
                {attr.key}: {attr.value}
                {attr.unit ? ` ${attr.unit}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Recent price history" className="mt-10">
        <h2 className="text-xl font-semibold">Recent price history ({history.rows.length})</h2>
        {history.error ? (
          <p className="mt-2 rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950">
            Price history could not be read: {history.error}
          </p>
        ) : history.rows.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No price history recorded for this product.
          </p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {history.rows.map((row) => (
              <li key={row.id} className="rounded-lg border p-3">
                {row.retailerSlug ?? row.retailerId}: {row.currency ?? ''} {row.price} ·{' '}
                {row.availability ?? 'availability unknown'} · {formatDateTime(row.recordedAt)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
