/**
 * Admin product specs page (Section 21–25, Stage C — B1 + K12) —
 * /admin/products/[id]/specs.
 *
 * Server component: loads the product and its specs (with
 * per-spec attribution) via services/admin-products.ts, then
 * renders the verify/correct form
 * (components/admin/product-spec-form.tsx). Guard:
 * /admin/layout.tsx redirects non-admins server-side. All copy is
 * literal English — no i18n keys are added for admin surfaces.
 * Unknown specs are shown as unknown, never pre-filled: the form
 * only records a value an admin types against a named source.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { getAdminProductById, listProductSpecsForAdmin } from '@/services/admin-products';
import { ProductSpecForm } from '@/components/admin/product-spec-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Verify specs — Admin — SmartBuy AI',
  description: 'Verify and correct a catalog product’s recorded specs. Admin only.',
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AdminProductSpecsPage({
  params,
}: {
  params: { id: string };
}) {
  const service = createSupabaseServiceClient();

  if (!service) {
    return (
      <main className="container mx-auto max-w-4xl px-4 py-12">
        <h1 className="text-3xl font-bold">Verify specs</h1>
        <p className="mt-4 text-muted-foreground">
          The service-role key is not configured, so the specs cannot
          be read. Set SUPABASE_SERVICE_ROLE_KEY in the hosting dashboard.
        </p>
      </main>
    );
  }

  const { product } = await getAdminProductById(service, params.id);
  if (!product) notFound();

  const view = await listProductSpecsForAdmin(service, params.id, product.category);

  return (
    <main className="container mx-auto max-w-4xl px-4 py-12">
      <p className="text-sm text-muted-foreground">
        <Link href="/admin/products" className="underline">
          ← All products
        </Link>{' '}
        ·{' '}
        <Link href={`/admin/products/${product.id}`} className="underline">
          Edit product
        </Link>
      </p>
      <h1 className="mt-2 text-3xl font-bold">Verify specs</h1>
      <p className="mt-2 text-muted-foreground">
        {product.name} · {product.slug} · category {product.category ?? 'unknown'}
      </p>
      {view.error ? (
        <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950">
          Specs could not be read: {view.error}
        </p>
      ) : (
        <>
          <p className="mt-4 text-sm text-muted-foreground">
            {view.specs.length} spec(s) stored. Unknown specs stay
            unknown until an admin records a real value against its
            source — nothing here is pre-filled or guessed.
            {view.attributionMissing
              ? ' Per-spec attribution is not stored yet (migration 058 not applied), so sources read as unattributed.'
              : ''}
          </p>
          <ProductSpecForm
            productId={product.id}
            rows={view.specs.map((spec) => ({
              key: spec.key,
              label: spec.key,
              value: spec.value,
              unit: spec.unit,
              source: spec.source,
              verifiedAt: spec.verifiedAt,
              verifiedBy: spec.verifiedBy,
            }))}
            templateKeys={view.templateKeys}
          />
        </>
      )}
    </main>
  );
}
