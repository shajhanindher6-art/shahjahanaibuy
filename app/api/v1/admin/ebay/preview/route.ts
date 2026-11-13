/**
 * Section 15, P3-2 — eBay admin preview (admin only).
 * POST /api/v1/admin/ebay/preview
 *
 * Two phases, one route, INSERTS NOTHING:
 *   1. Search: `{ q, limit?, condition? }` — runs the Browse search
 *      and returns the listings with the admin's editable fields
 *      left blank (brand/category/slug must be supplied per
 *      listing; eBay carries none of them).
 *   2. Review: the same body plus `items: [{ itemId, brand,
 *      category, slug, description? }]` — maps the listed items,
 *      runs the shared review (slug / name+brand / itemId dedupe),
 *      and returns the review + the raw rows for the approve step.
 *
 * Approve reuses the EXISTING intake approve unchanged in flow:
 * POST /api/v1/admin/intake `{ action: 'approve', rows,
 * includeRowNumbers, source: 'ebay-browse-api' }` — the existing
 * route re-validates server-side and inserts only valid rows.
 *
 * Every search here reserves one call from the global eBay daily
 * budget (cap 4,500/day); the remaining budget is returned so the
 * admin UI can show it. Admin ingestion shares the counter with
 * public search and refresh.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  apiSuccess,
  badRequest,
  internalError,
  rateLimited,
  serviceUnavailable,
} from '@/lib/api/responses';
import {
  logApiRequest,
  requireAdmin,
  rateLimitResponse,
  getClientIp,
} from '@/lib/api/middleware';
import { checkCsrfOrigin } from '@/lib/api/csrf';
import { recordAdminAction } from '@/services/admin';
import {
  isEbayConfigured,
  searchEbayListings,
} from '@/services/ebay-browse';
import {
  getEbayDailyBudget,
  reserveEbayDailyCall,
} from '@/services/ebay-budget';
import {
  EBAY_INTAKE_SOURCE,
  EBAY_MERCHANT_SLUG,
  reviewEbayIntakeRows,
  type EbayIntakeFieldOverrides,
} from '@/services/ebay-intake';
import { validateLocalFirstQuery } from '@/services/local-first-search';
import { loadCatalogContext } from '@/app/api/v1/admin/intake/route';
import {
  adminEbayPreviewSchema,
  invalidBodyResponse,
  validateBody,
} from '@/lib/api/validation';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

const MAX_ITEMS = 10;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'admin.ebay-preview' });
  const limited = await rateLimitResponse(
    `admin.ebay-preview:${getClientIp(request)}`,
    30
  );
  if (limited) return limited;

  // Sections 21–25, Stage G, G-P1-3 — CSRF Origin check
  // (cookie-authed mutation; absent Origin fails open for
  // non-browser clients). The middleware layer checks this too.
  const csrf = checkCsrfOrigin(request);
  if (csrf) return csrf;

  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const service = createSupabaseServiceClient();
  if (!service) {
    return internalError('eBay preview unavailable: service client not configured');
  }

  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body)) {
    return badRequest('Expected a JSON body with a "q" field');
  }

  // Sections 21–25, Stage G, G-P2-1 — shared Zod shape gate
  // (type/bounds only; the query itself is still validated by
  // validateLocalFirstQuery below, keeping its message).
  const invalid = invalidBodyResponse(validateBody(adminEbayPreviewSchema, body));
  if (invalid) return invalid;

  const validated = validateLocalFirstQuery(body.q);
  if (!validated.ok) return badRequest(validated.error);
  const query = validated.query;

  const rawLimit = typeof body.limit === 'number' ? body.limit : undefined;
  const limit =
    rawLimit !== undefined && Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.floor(rawLimit), 1), 10)
      : undefined;
  const condition =
    typeof body.condition === 'string' ? body.condition : undefined;

  // Budget first (read-only): the UI shows what is left before
  // the admin spends a call.
  const budgetBefore = await getEbayDailyBudget(service);

  if (!isEbayConfigured()) {
    return apiSuccess({
      source: EBAY_INTAKE_SOURCE,
      configured: false,
      listings: [],
      budget: budgetBefore,
      priceNote:
        'eBay live search is not configured (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET missing). No listings can be previewed.',
    });
  }

  // Reserve one call from the global daily budget. At the cap the
  // preview refuses honestly instead of spending past 4,500.
  const budget = await reserveEbayDailyCall(service);
  if (!budget.allowed) {
    return rateLimited(
      'eBay daily budget used — try tomorrow. The catalog and search links still work.',
      {
        budgetRemaining: 0,
        budgetLimit: budget.limit,
        budgetUsed: budget.used,
      }
    );
  }

  const fetchedAt = new Date().toISOString();

  // Sections 21–25, Stage G, G-P1-2 — audit the budget spend.
  // The reservation above already consumed one call from the
  // shared daily budget, so the spend is logged even when the
  // search itself then fails. recordAdminAction never throws.
  await recordAdminAction(
    service,
    auth.userId,
    'ebay_preview_budget_spend',
    'ebay_budget',
    null,
    {
      query,
      phase: Array.isArray(body.items) ? 'review' : 'search',
      budgetUsed: budget.used,
      budgetRemaining: budget.remaining,
      budgetLimit: budget.limit,
    },
    getClientIp(request)
  );

  const result = await searchEbayListings(query, { limit, condition });
  if (!result.ok) {
    if (result.reason === 'rate-limited') {
      return rateLimited(
        'eBay rate-limited this request — try again shortly.',
        { budgetRemaining: budget.remaining, budgetLimit: budget.limit }
      );
    }
    return serviceUnavailable(
      'eBay is temporarily unavailable. Try again later.'
    );
  }

  // Phase 1 — search only: return the listings for the admin to
  // annotate with brand / category / slug.
  const items = Array.isArray(body.items) ? body.items : undefined;
  if (!items) {
    return apiSuccess({
      source: EBAY_INTAKE_SOURCE,
      configured: true,
      listings: result.listings,
      budget,
      fetchedAt,
      priceNote:
        'Live eBay asking prices, checked just now. They are snapshots of ephemeral listings — no price history, no Deal Score, no alerts are ever created from them.',
    });
  }

  // Phase 2 — review: map the admin-annotated items and review.
  if (items.length === 0) {
    return badRequest('Review requires at least one annotated item');
  }
  if (items.length > MAX_ITEMS) {
    return badRequest(`Too many items (${items.length}); max ${MAX_ITEMS} per preview`);
  }

  const listingById = new Map(result.listings.map((l) => [l.itemId, l]));
  const fieldsByItemId = new Map<string, EbayIntakeFieldOverrides>();
  const unmatchedItems: string[] = [];
  for (const raw of items as unknown[]) {
    if (!isRecord(raw) || typeof raw.itemId !== 'string') continue;
    if (!listingById.has(raw.itemId)) {
      unmatchedItems.push(raw.itemId);
      continue;
    }
    fieldsByItemId.set(raw.itemId, {
      brand: typeof raw.brand === 'string' ? raw.brand.trim() : '',
      category: typeof raw.category === 'string' ? raw.category.trim() : '',
      slug: typeof raw.slug === 'string' ? raw.slug.trim() : '',
      ...(typeof raw.description === 'string' && raw.description.trim()
        ? { description: raw.description.trim() }
        : {}),
    });
  }
  if (fieldsByItemId.size === 0) {
    return badRequest(
      'None of the annotated items match the listings just fetched — search again and annotate the fresh results'
    );
  }

  let context;
  try {
    context = await loadCatalogContext(service);
  } catch (err) {
    logApiError(err, { request, route: 'admin.ebay.preview', status: 500 });
    return internalError('Failed to load catalog data for validation');
  }

  // Live set of eBay merchant_sku values (rule 3 dedupe). When
  // the eBay merchant row is absent (owner-gated), the shared
  // review reports "Unknown merchant" per row instead — honest,
  // and merchants are never auto-created.
  const existingEbaySkus = new Set<string>();
  try {
    const { data: ebayMerchant } = await service
      .from('merchants')
      .select('id')
      .eq('slug', EBAY_MERCHANT_SLUG)
      .maybeSingle();
    const ebayId = (ebayMerchant as { id?: string } | null)?.id;
    if (ebayId) {
      const { data: skuRows } = await service
        .from('merchant_products')
        .select('merchant_sku')
        .eq('merchant_id', ebayId)
        .not('merchant_sku', 'is', null)
        .limit(5000);
      for (const r of (skuRows ?? []) as Array<{ merchant_sku: string | null }>) {
        if (r.merchant_sku) existingEbaySkus.add(r.merchant_sku);
      }
    }
  } catch {
    // A failed SKU load means the itemId dedupe cannot run; the
    // slug/name-brand rules still apply, and the approve step
    // re-validates. Log nothing secret here — just continue.
  }

  const reviewed = reviewEbayIntakeRows(
    result.listings,
    fieldsByItemId,
    context,
    existingEbaySkus,
    { query, fetchedAt }
  );

  return apiSuccess({
    source: EBAY_INTAKE_SOURCE,
    configured: true,
    listings: result.listings,
    budget,
    fetchedAt,
    review: reviewed.review,
    rows: reviewed.rows,
    ebayDuplicates: reviewed.ebayDuplicates,
    skippedItems: reviewed.skippedItems,
    unmatchedItems,
    provenance: reviewed.provenance,
    priceNote:
      'Live eBay asking prices, checked just now. Approving inserts the product + one eBay merchant listing labelled "Live eBay asking price, checked <timestamp>" — no price history, no Deal Score, no alerts are ever created from them.',
  });
}
