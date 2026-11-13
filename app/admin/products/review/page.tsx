/**
 * Admin catalog review queues (Section 20, §12 #70) —
 * /admin/products/review?view=duplicates|specs|images|history.
 *
 * Read-only review views:
 * - duplicates: candidate pairs (same GTIN, or same normalized
 *   name+brand). No merge action exists yet — the view says so
 *   instead of inventing one.
 * - specs: products with zero stored specs. No admin spec write
 *   API exists — the view says so.
 * - images: per-product image status (missing / invalid URL /
 *   ok). Image URLs are corrected from the product edit page.
 * - history: per-product price-history coverage; ?product=<id>
 *   shows that product's newest rows.
 *
 * The duplicate list prefers `findDuplicateCandidates` from
 * services/pipeline/deduplication.ts when it exists (another
 * Section 20 worker is adding it); until then it runs the
 * in-service scan, and the page states which source ran.
 * Guard: /admin/layout.tsx redirects non-admins server-side.
 * All copy is literal English — no i18n keys are added.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireAdminPage } from '@/lib/admin-page-guard';
import {
  getAdminProductPriceHistory,
  listCategoriesMissingSpecTemplates,
  listDuplicateCandidates,
  listProductImageStatus,
  listProductsMissingSpecs,
  listProductsPriceHistorySummary,
  listSpecCompleteness,
} from '@/services/admin-products';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Catalog review — Admin — SmartBuy AI',
  description: 'Review duplicate candidates, missing specs, image status, and price history. Admin only.',
  robots: {
    index: false,
    follow: false,
  },
};

type ReviewView = 'duplicates' | 'specs' | 'images' | 'history';

const VIEWS: Array<{ key: ReviewView; label: string }> = [
  { key: 'duplicates', label: 'Duplicate candidates' },
  { key: 'specs', label: 'Missing specs' },
  { key: 'images', label: 'Image status' },
  { key: 'history', label: 'Price history' },
];

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

export default async function AdminReviewPage({
  searchParams,
}: {
  searchParams: { view?: string; product?: string; check?: string };
}) {
  // Final 100%, F-P1-62 — per-page server-side admin re-check
  // (the layout guard alone is not the only check anymore).
  await requireAdminPage();
  const view: ReviewView =
    searchParams.view === 'specs' ||
    searchParams.view === 'images' ||
    searchParams.view === 'history'
      ? searchParams.view
      : 'duplicates';
  const service = createSupabaseServiceClient();

  if (!service) {
    return (
      <main className="container mx-auto max-w-6xl px-4 py-12">
        <h1 className="text-3xl font-bold">Catalog review</h1>
        <p className="mt-4 text-muted-foreground">
          The service-role key is not configured, so the review queues
          cannot be read. Set SUPABASE_SERVICE_ROLE_KEY in the hosting
          dashboard.
        </p>
      </main>
    );
  }

  const duplicates =
    view === 'duplicates' ? await listDuplicateCandidates(service, 50) : null;
  const missingSpecs =
    view === 'specs' ? await listProductsMissingSpecs(service, 50) : null;
  // FINAL 100%, F-P1-09 / F-P2-32 — per-product spec completeness
  // (which required keys are missing) and the list of categories
  // with no spec template at all.
  const specCompleteness =
    view === 'specs' ? await listSpecCompleteness(service, 50) : null;
  const missingTemplates =
    view === 'specs' ? await listCategoriesMissingSpecTemplates(service) : null;
  // FINAL 100%, F-P2-29 — reachability HEAD checks run only when
  // the admin explicitly asks (?check=live); the default review
  // never blocks on a slow merchant CDN.
  const imageStatus =
    view === 'images'
      ? await listProductImageStatus(service, 50, {
          checkReachability: searchParams.check === 'live',
        })
      : null;
  const historySummary =
    view === 'history' ? await listProductsPriceHistorySummary(service, 50) : null;
  const historyDetail =
    view === 'history' && searchParams.product
      ? await getAdminProductPriceHistory(service, searchParams.product, 20)
      : null;

  return (
    <main className="container mx-auto max-w-6xl px-4 py-12">
      <h1 className="text-3xl font-bold">Catalog review</h1>
      <p className="mt-2 text-muted-foreground">
        Read-only review queues. Where no approve / reject / correct
        action exists yet, the view says so — no action is invented.
      </p>
      <p className="mt-2 text-sm">
        <Link href="/admin/products" className="underline">
          ← All products
        </Link>
      </p>

      <nav aria-label="Review views" className="mt-6 flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={`/admin/products/review?view=${v.key}`}
            aria-current={view === v.key ? 'page' : undefined}
            className={
              view === v.key
                ? 'rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white'
                : 'rounded-lg border px-4 py-2 text-sm font-medium'
            }
          >
            {v.label}
          </Link>
        ))}
      </nav>

      {view === 'duplicates' && duplicates ? (
        <section aria-label="Duplicate candidates" className="mt-6">
          <h2 className="text-xl font-semibold">Duplicate candidates</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Candidates found by{' '}
            {duplicates.source === 'deduplication-service'
              ? 'the pipeline deduplication service'
              : 'an in-service scan (same GTIN, or same normalized name and brand) — the pipeline helper could not run, so this scan runs instead'}
            . No merge action exists yet: review a pair, then correct
            or delete the wrong row from its product edit page.
          </p>
          {duplicates.error ? (
            <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950">
              Duplicate candidates could not be read: {duplicates.error}
            </p>
          ) : duplicates.candidates.length === 0 ? (
            <div className="mt-4 rounded-lg border p-6">
              <p className="font-medium">No duplicate candidates found.</p>
              <p className="mt-2 text-sm text-muted-foreground">
                No two products share a GTIN or a normalized
                name-and-brand in the scanned set (up to 500 products).
                That is a scan result, not proof the catalog is
                duplicate-free — near-duplicates with different
                spellings are not detected.
              </p>
            </div>
          ) : (
            <ul className="mt-4 space-y-3">
              {duplicates.candidates.map((c) => (
                <li key={`${c.productA.id}-${c.productB.id}`} className="rounded-lg border p-4">
                  <p className="text-sm font-medium">
                    Matched by {c.matchedBy === 'gtin' ? 'GTIN' : 'name and brand'} — {c.detail}
                  </p>
                  <p className="mt-2 text-sm">
                    <Link href={`/admin/products/${c.productA.id}`} className="underline">
                      {c.productA.name}
                    </Link>{' '}
                    ({c.productA.brand ?? 'no brand'}
                    {c.productA.gtin ? ` · GTIN ${c.productA.gtin}` : ''})
                  </p>
                  <p className="mt-1 text-sm">
                    <Link href={`/admin/products/${c.productB.id}`} className="underline">
                      {c.productB.name}
                    </Link>{' '}
                    ({c.productB.brand ?? 'no brand'}
                    {c.productB.gtin ? ` · GTIN ${c.productB.gtin}` : ''})
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {view === 'specs' && missingSpecs ? (
        <section aria-label="Missing specs" className="mt-6">
          <h2 className="text-xl font-semibold">Missing specs</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {missingSpecs.checked} product(s) checked,{' '}
            {missingSpecs.products.length} with no specs stored at all.
            There is no admin spec write API yet, so specs cannot be
            corrected from here — they arrive through intake.
          </p>
          {missingSpecs.error ? (
            <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950">
              Missing specs could not be read: {missingSpecs.error}
            </p>
          ) : missingSpecs.products.length === 0 ? (
            <div className="mt-4 rounded-lg border p-6">
              <p className="font-medium">Every checked product has at least one spec.</p>
            </div>
          ) : (
            <ul className="mt-4 space-y-2">
              {missingSpecs.products.map((p) => (
                <li key={p.id} className="rounded-lg border p-4 text-sm">
                  <Link href={`/admin/products/${p.id}`} className="font-medium underline">
                    {p.name}
                  </Link>{' '}
                  <span className="text-muted-foreground">
                    · {p.brand ?? 'No brand'} · {p.category ?? 'No category'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {/* FINAL 100%, F-P1-09 — spec completeness per product:
              which required template keys are missing. A product
              with some specs but not all is listed here too — the
              queue above only catches products with zero specs. */}
          {specCompleteness && !specCompleteness.error ? (
            <div className="mt-6">
              <h3 className="font-medium">Spec completeness</h3>
              <ul className="mt-2 space-y-2">
                {specCompleteness.rows.map((row) => (
                  <li key={row.productId} className="rounded-lg border p-4 text-sm">
                    <Link href={`/admin/products/${row.productId}`} className="font-medium underline">
                      {row.name}
                    </Link>{' '}
                    <span className="text-muted-foreground">
                      {row.hasTemplate
                        ? row.complete
                          ? '— all required specs recorded'
                          : `— missing: ${row.missingKeys.join(', ')}`
                        : '— no spec template for this category, so completeness cannot be checked'}
                      {row.unknownKeys.length > 0
                        ? ` · unknown keys (reported, not dropped): ${row.unknownKeys.join(', ')}`
                        : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {/* FINAL 100%, F-P2-32 — categories with no spec template.
              Specs for these categories cannot be validated by
              design; this is the list, so an admin can see which
              categories are affected instead of discovering it one
              failed validation at a time. */}
          {missingTemplates && !missingTemplates.error ? (
            <div className="mt-6">
              <h3 className="font-medium">Categories without a spec template</h3>
              {missingTemplates.categories.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Every category in the catalog has a spec template.
                </p>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  {missingTemplates.categories.join(', ')} — specs for these categories cannot be
                  validated until a template is added.
                </p>
              )}
            </div>
          ) : null}
        </section>
      ) : null}

      {view === 'images' && imageStatus ? (
        <section aria-label="Image status" className="mt-6">
          <h2 className="text-xl font-semibold">Image status</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {imageStatus.checked} product(s) checked. An invalid URL
            can be corrected from the product edit page; a missing
            image needs a real image URL from a licensed or merchant
            source — never a guessed one.
            {imageStatus.reachabilityChecked
              ? ' Reachability was HEAD-checked on this view.'
              : ''}{' '}
            <Link
              href="/admin/products/review?view=images&check=live"
              className="underline"
            >
              Check reachability now
            </Link>
            {' '}(HEAD-checks every image URL; may take a few seconds.)
          </p>
          {imageStatus.error ? (
            <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950">
              Image status could not be read: {imageStatus.error}
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {imageStatus.rows.map((row) => (
                <li key={row.productId} className="rounded-lg border p-4 text-sm">
                  <Link href={`/admin/products/${row.productId}`} className="font-medium underline">
                    {row.name}
                  </Link>{' '}
                  <span className="text-muted-foreground">
                    —{' '}
                    {row.status === 'ok'
                      ? `image ok (${row.imageCount} gallery image(s))`
                      : row.status === 'missing-image'
                        ? 'no image URL stored'
                        : row.status === 'broken-image'
                          ? `image URL does not load (HEAD check failed): ${row.imageUrl ?? ''}`
                          : `invalid image URL: ${row.imageUrl ?? ''}`}
                    {row.status === 'ok' && row.imageCount === 0
                      ? ' · no gallery rows'
                      : ''}
                    {row.reachable === true ? ' · reachable' : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {view === 'history' && historySummary ? (
        <section aria-label="Price history" className="mt-6">
          <h2 className="text-xl font-semibold">Price history</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            One row per product: how many price points are recorded and
            when the newest was recorded. A product with 0 points has
            no recorded price history — that is the finding, not a
            missing row.
          </p>
          {historySummary.error ? (
            <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950">
              Price history could not be read: {historySummary.error}
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {historySummary.rows.map((row) => (
                <li key={row.productId} className="rounded-lg border p-4 text-sm">
                  <Link
                    href={`/admin/products/review?view=history&product=${row.productId}`}
                    className="font-medium underline"
                  >
                    {row.name}
                  </Link>{' '}
                  <span className="text-muted-foreground">
                    · {row.pointCount} point(s)
                    {row.latestRecordedAt
                      ? ` · newest ${formatDateTime(row.latestRecordedAt)}`
                      : ' · no history recorded'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {historyDetail ? (
            <div className="mt-6 rounded-lg border p-4">
              <h3 className="font-medium">Newest price points</h3>
              {historyDetail.error ? (
                <p className="mt-2 text-sm text-red-700 dark:text-red-300">
                  Could not be read: {historyDetail.error}
                </p>
              ) : historyDetail.rows.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  No price history recorded for this product.
                </p>
              ) : (
                <ul className="mt-2 space-y-2 text-sm">
                  {historyDetail.rows.map((row) => (
                    <li key={row.id}>
                      {row.retailerSlug ?? row.retailerId}: {row.currency ?? ''} {row.price} ·{' '}
                      {row.availability ?? 'availability unknown'} · {formatDateTime(row.recordedAt)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
