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
  getDataQualityState,
  isValidGtin,
} from '@/services/product-quality-score';
import { priceVerificationLabel } from '@/services/price-verification';
import { formatLastChecked } from '@/lib/price-freshness';
import { ProductEditForm } from '@/components/admin/product-edit-form';
import { getProductAttribution } from '@/services/product-attribution';
import { getMerchantCurrencies } from '@/services/merchant-currency';
import { requireAdminPage } from '@/lib/admin-page-guard';

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
  // Final 100%, F-P1-62 — per-page server-side admin re-check
  // (the layout guard alone is not the only check anymore).
  await requireAdminPage();
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

  const { contexts, merchantSourceMissing } = await getProductQualityContexts(service, [product.id]);
  const productCtx = contexts.get(product.id) ?? {};
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
    productCtx
  );
  // Section 21–25, Stage H (H-P2-2): the same 5-state taxonomy the
  // public product page shows, from the same inputs.
  const qualityState = getDataQualityState({
    priceVerificationStatus: product.priceVerificationStatus,
    priceAgeDays: score.priceAgeDays,
    merchantCount: productCtx.merchantCount ?? 0,
    hasValidGtin: isValidGtin(product.gtin),
    hasPriceSource: (productCtx.priceSource ?? null) !== null,
  });
  const verification = priceVerificationLabel(
    product.priceVerificationStatus,
    formatLastChecked(product.priceVerifiedAt)
  );
  const attributes = await getProductAttributes(service, product.id);
  const history = await getAdminProductPriceHistory(service, product.id, 10);
  // Final 100%, F-P1-05 + F-P1-58 — product-level source
  // attribution and the stored merchant currency. Both readers
  // are fail-closed: no recorded source / currency renders as
  // "not recorded", never as a guess.
  const attribution = await getProductAttribution(service, product.id);
  const { byProduct: currenciesByProduct } = await getMerchantCurrencies(service, [product.id]);
  const merchantCurrencies = currenciesByProduct.get(product.id) ?? [];

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
          Grade: {score.grade}. Data verification: <strong>{qualityState.label}</strong> —{' '}
          {qualityState.reason} This is a data quality score — how
          complete, verifiable, and fresh this product&apos;s record is
          — never a judgement of the product itself.
        </p>
        {/* Final 100% (F-P1-29 / F-P1-06) — the brief's 5-state
            price machine and the whole-record fully-verified
            verdict, from the same scorer inputs as above. Only
            LIVE_VERIFIED may be shown with live/current wording;
            a product is fully verified only when every criterion
            passes — the missing list says what would close it. */}
        <p className="mt-1 text-sm text-muted-foreground">
          Price state: <strong>{score.priceState.label}</strong> — {score.priceState.reason}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Fully verified: <strong>{score.fullyVerified.fullyVerified ? 'Yes' : 'No'}</strong>
          {score.fullyVerified.fullyVerified
            ? ''
            : ` — missing: ${score.fullyVerified.missing.join(', ')}`}
        </p>
        {/* Section 21–25, Stage H (H-P2-4): say the score may
            understate while the price-source column is missing. */}
        {merchantSourceMissing ? (
          <p className="mt-2 text-sm text-muted-foreground">
            This score may understate data quality: the merchant
            price-source column does not exist yet (migration 045 not
            applied), so the attribution dimension cannot count a
            recorded price source.
          </p>
        ) : null}
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

      {/* Final 100%, F-P1-05 — product-level source attribution:
          which merchant supplied the price, which pipeline
          provider rows exist, and how many specs carry a source.
          "No source recorded" is the honest state when nothing was
          recorded — the live "manual-intake" label is a fail-open
          default, not a stored fact, and is not repeated here. */}
      <section aria-label="Source attribution" className="mt-10">
        <h2 className="text-xl font-semibold">Source attribution</h2>
        {!attribution.hasAnyAttribution ? (
          <p className="mt-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No source recorded for this product. No merchant listing carries a recorded
            price source, no pipeline provider row exists, and no spec carries a source.
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {attribution.merchantSources.map((m) => (
              <li key={m.merchantId}>
                {m.merchantName ?? m.merchantId}: price source{' '}
                {m.priceSource ?? 'not recorded'}
                {m.priceVerifiedAt ? ` — verified ${formatDateTime(m.priceVerifiedAt)}` : ''}
              </li>
            ))}
            {attribution.productSources.map((s) => (
              <li key={`${s.providerKey}-${s.lastFetchedAt ?? 'unknown'}`}>
                Pipeline provider {s.providerKey}
                {s.sourceUrl ? ` — ${s.sourceUrl}` : ''}
                {s.lastFetchedAt ? ` — last fetched ${formatDateTime(s.lastFetchedAt)}` : ''}
              </li>
            ))}
            {attribution.specsTotal > 0 ? (
              <li>
                Specs attributed: {attribution.specsAttributed}/{attribution.specsTotal}
                {attribution.specsAttributionMissing ? ' (attribution columns not applied yet — migration 058)' : ''}
              </li>
            ) : null}
          </ul>
        )}
        {attribution.columnsMissing ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Merchant price-source columns do not exist yet (migration 045 not applied), so
            listing sources cannot be shown.
          </p>
        ) : null}
        {attribution.notes.length > 0 && attribution.hasAnyAttribution ? (
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {attribution.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* Final 100%, F-P1-58 — the stored currency on the
          merchant rows, rendered as recorded. A row with no
          recorded currency is labelled as such; USD is assumed in
          refresh run counts only, never presented as stored. */}
      <section aria-label="Recorded currency" className="mt-10">
        <h2 className="text-xl font-semibold">Recorded currency</h2>
        {merchantCurrencies.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No merchant rows for this product, so no currency is recorded.
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {merchantCurrencies.map((c, i) => (
              <li key={`${c.merchantId}-${i}`}>
                {c.code ?? 'Currency not recorded'}
                {c.code === null ? ' — USD assumed in refresh run counts only, not stored' : ''}
                {c.unknownCurrencyId ? ' — recorded currency_id has no matching currencies row' : ''}
              </li>
            ))}
          </ul>
        )}
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
            No specs stored for this product.{' '}
            <Link href={`/admin/products/${product.id}/specs`} className="underline">
              Verify / correct specs
            </Link>{' '}
            — record a real value against its source, or leave it unknown.
          </p>
        ) : (
          <>
            <ul className="mt-2 space-y-1 text-sm">
              {attributes.map((attr) => (
                <li key={attr.id}>
                  {attr.key}: {attr.value}
                  {attr.unit ? ` ${attr.unit}` : ''}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm">
              <Link href={`/admin/products/${product.id}/specs`} className="underline">
                Verify / correct specs
              </Link>
            </p>
          </>
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
