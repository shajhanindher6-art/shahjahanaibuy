/**
 * POST /api/retailers/sync — admin only, on-demand retailer sync REPORT.
 * Retailers Delta (2026-11-15).
 *
 * What it does: for one retailer (or all four when `retailer` is
 * omitted), take the first N products from the products table by
 * name, search the retailer's registered provider for each one,
 * and return per-product outcomes (matched / not-found / invalid
 * / error) with the normalized fields — using the EXISTING
 * pipeline (services/pipeline/validation.ts +
 * services/pipeline/normalization.ts). No new normalizer.
 *
 * What it does NOT do: it writes NOTHING — no merchant_products,
 * no price_history, no ingestion. Ingestion stays with the
 * existing refresh chain (POST /api/v1/prices/refresh, the
 * single scheduler — cron-job.org every 6h). This route reports;
 * an admin reads the report and the refresh chain does the
 * writing. There is NO scheduler, NO cron, NO setInterval here —
 * on-demand only, admin-triggered.
 *
 * Missing keys are NOT an error: an unavailable provider returns
 * 200 with status 'not-configured' + the provider's plain-language
 * reason (never a 500, never a throw). Provider fetch failures
 * are per-product 'error' outcomes, never a failed route.
 * Auth failures (401/403) and DB failures (500) are the only
 * non-200 paths, copied from the admin providers route
 * (app/api/v1/admin/providers/route.ts).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import {
  logApiRequest,
  requireAdmin,
  rateLimitResponse,
  getClientIp,
} from '@/lib/api/middleware';
import { logApiError } from '@/lib/api/error-logging';
import { getProviderRegistry } from '@/services/providers/registry';
import { callProviderSearch } from '@/services/providers/call-guard';
import { ProviderNotConfiguredError } from '@/services/providers/errors';
import { validateRawProduct } from '@/services/pipeline/validation';
import { normalizeProduct, type NormalizedProduct } from '@/services/pipeline/normalization';

export const dynamic = 'force-dynamic';

const SUPPORTED_RETAILERS = ['walmart', 'ebay', 'bestbuy', 'amazon'] as const;
type SupportedRetailer = (typeof SUPPORTED_RETAILERS)[number];
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
/** Hits requested per product — the report needs the first match only. */
const SEARCH_RESULTS_PER_PRODUCT = 3;

type ProductOutcome = 'matched' | 'not-found' | 'invalid' | 'error';
type RetailerStatus = 'ok' | 'not-configured' | 'error';

interface SyncProductResult {
  productSlug: string;
  productName: string;
  outcome: ProductOutcome;
  normalized: {
    slug: string;
    name: string;
    price: number;
    currency: string;
    availability: string;
    imageUrl: string | null;
    gtin: string | null;
    modelNumber: string | null;
    externalId: string;
    retailerSlug: string;
    url: string | null;
    confidenceScore: number;
  } | null;
  error: string | null;
}

interface SyncRetailerResult {
  retailer: SupportedRetailer;
  status: RetailerStatus;
  reason: string | null;
  productsChecked: number;
  matched: number;
  results: SyncProductResult[];
}

function pickNormalizedFields(normalized: NormalizedProduct): NonNullable<SyncProductResult['normalized']> {
  return {
    slug: normalized.slug,
    name: normalized.name,
    price: normalized.price,
    currency: normalized.currency,
    availability: normalized.availability,
    imageUrl: normalized.imageUrl,
    gtin: normalized.gtin,
    modelNumber: normalized.modelNumber,
    externalId: normalized.externalId,
    retailerSlug: normalized.retailerSlug,
    url: normalized.url,
    confidenceScore: normalized.confidenceScore,
  };
}

function isSupportedRetailer(value: unknown): value is SupportedRetailer {
  return typeof value === 'string' && (SUPPORTED_RETAILERS as readonly string[]).includes(value);
}

async function syncOneRetailer(
  retailer: SupportedRetailer,
  products: Array<{ name: string; slug: string }>,
): Promise<SyncRetailerResult> {
  const registry = getProviderRegistry();
  const provider = registry.getForRetailer(retailer);
  if (!provider) {
    // No override OR override unavailable (getForRetailer never
    // falls back to another merchant). When the provider IS
    // registered but unavailable, its own reason explains why.
    const registered = registry.get(retailer);
    return {
      retailer,
      status: 'not-configured',
      reason:
        registered?.getNotConfiguredReason() ??
        `No provider is configured for merchant '${retailer}'.`,
      productsChecked: 0,
      matched: 0,
      results: [],
    };
  }

  const results: SyncProductResult[] = [];
  let matched = 0;
  try {
    for (const product of products) {
      try {
        // Guarded call: daily budget + circuit breaker + 10s
        // timeout + transient retries (services/providers/call-guard.ts).
        const hits = await callProviderSearch(provider, {
          query: product.name,
          limit: SEARCH_RESULTS_PER_PRODUCT,
        });
        if (hits.length === 0) {
          results.push({
            productSlug: product.slug,
            productName: product.name,
            outcome: 'not-found',
            normalized: null,
            error: null,
          });
          continue;
        }
        const validated = validateRawProduct(hits[0]);
        if (!validated.success) {
          const firstError = Object.values(validated.errors).flat()[0] ?? 'validation failed';
          results.push({
            productSlug: product.slug,
            productName: product.name,
            outcome: 'invalid',
            normalized: null,
            error: firstError,
          });
          continue;
        }
        const normalized = normalizeProduct(validated.data);
        matched += 1;
        results.push({
          productSlug: product.slug,
          productName: product.name,
          outcome: 'matched',
          normalized: pickNormalizedFields(normalized),
          error: null,
        });
      } catch (err) {
        if (err instanceof ProviderNotConfiguredError) {
          // The provider went unavailable mid-loop (key removed
          // between the check and the call): the whole retailer
          // is not-configured, not one failed product.
          return {
            retailer,
            status: 'not-configured',
            reason: err.reason,
            productsChecked: results.length,
            matched,
            results,
          };
        }
        results.push({
          productSlug: product.slug,
          productName: product.name,
          outcome: 'error',
          normalized: null,
          error: err instanceof Error ? err.message : 'search failed',
        });
      }
    }
  } catch (err) {
    // Anything escaping the per-product handling is a retailer-level error.
    return {
      retailer,
      status: 'error',
      reason: err instanceof Error ? err.message : 'retailer sync failed',
      productsChecked: results.length,
      matched,
      results,
    };
  }
  return {
    retailer,
    status: 'ok',
    reason: null,
    productsChecked: results.length,
    matched,
    results,
  };
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'retailers.sync' });
  const limited = await rateLimitResponse(`retailers.sync:${getClientIp(request)}`, 60);
  if (limited) return limited;

  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const body: unknown = await request.json().catch(() => ({}));
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};

  let retailers: SupportedRetailer[];
  if (raw.retailer === undefined || raw.retailer === null) {
    retailers = [...SUPPORTED_RETAILERS];
  } else if (isSupportedRetailer(raw.retailer)) {
    retailers = [raw.retailer];
  } else {
    return badRequest(
      `Unknown retailer: ${typeof raw.retailer === 'string' ? raw.retailer : 'invalid'}. Expected one of: ${SUPPORTED_RETAILERS.join(', ')}.`,
    );
  }

  let limit = DEFAULT_LIMIT;
  if (raw.limit !== undefined && raw.limit !== null) {
    if (typeof raw.limit !== 'number' || !Number.isFinite(raw.limit)) {
      return badRequest('limit must be a number.');
    }
    limit = Math.min(Math.max(Math.floor(raw.limit), 1), MAX_LIMIT);
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    logApiError(new Error('retailers.sync: service client unavailable'), {
      request,
      route: 'retailers.sync',
      status: 500,
    });
    return internalError('Service client unavailable');
  }

  const { data: productRows, error: productError } = await service
    .from('products')
    .select('id, name, slug')
    .order('name', { ascending: true })
    .limit(limit);
  if (productError || !productRows) {
    logApiError(new Error(`retailers.sync: could not load products: ${productError?.message ?? 'no rows returned'}`), {
      request,
      route: 'retailers.sync',
      status: 500,
    });
    return internalError('Failed to load products');
  }

  const products = (productRows as Array<{ name: string; slug: string }>).map((row) => ({
    name: row.name,
    slug: row.slug,
  }));

  const results: SyncRetailerResult[] = [];
  for (const retailer of retailers) {
    results.push(await syncOneRetailer(retailer, products));
  }

  return apiSuccess({
    retailers: results,
    productsChecked: products.length,
    limit,
  });
}
