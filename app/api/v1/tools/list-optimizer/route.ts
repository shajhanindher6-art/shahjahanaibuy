/**
 * API v1 list optimizer — Section 7, item 1.
 * GET  /api/v1/tools/list-optimizer — the signed-in user's saved
 *        shopping lists; with ?list_id=, that list plus its cheapest
 *        split computed from REAL recorded merchant listings.
 * POST /api/v1/tools/list-optimizer — save a list (name + items) and
 *        return it with its optimization. Items reference catalog
 *        products by slug; quantities are 1..99.
 *
 * Fail-safe: until migration 033 (shopping_lists /
 * shopping_list_items) runs, GET returns { lists: [], listsEnabled:
 * false } and POST returns 503. No price is ever invented: a product
 * with no merchant listing is reported as "no listing" and excluded
 * from the totals.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  internalError,
  serviceUnavailable,
  validationError,
} from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, requireAuth } from '@/lib/api/middleware';
import { isMissingTableError } from '@/lib/agent-hunt';
import {
  normalizeListItems,
  optimizeShoppingList,
  type ListOptimization,
  type MerchantListingInput,
} from '@/lib/list-optimizer';
import type { SupabaseClient } from '@supabase/supabase-js';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

const LIST_COLUMNS = 'id, user_id, name, created_at';
const ITEM_COLUMNS = 'id, list_id, product_slug, quantity';

function isMissingTableOrColumn(error: unknown): boolean {
  if (isMissingTableError(error)) return true;
  const e = error as { code?: unknown; message?: unknown } | null;
  if (e?.code === '42703') return true;
  return typeof e?.message === 'string' && /column .* does not exist/i.test(e.message);
}

interface ProductRow {
  id: string;
  slug: string;
  name: string | null;
}

interface MerchantProductRow {
  product_id: string;
  merchant_id: string;
  price: number | string;
  url: string | null;
}

async function loadOptimization(
  supabase: SupabaseClient,
  items: Array<{ productSlug: string; quantity: number }>
): Promise<ListOptimization> {
  const slugs = [...new Set(items.map((i) => i.productSlug))];
  const { data: products } = await supabase
    .from('products')
    .select('id, slug, name')
    .in('slug', slugs);
  const productRows = (products ?? []) as ProductRow[];
  const idBySlug = new Map(productRows.map((p) => [p.slug, p.id]));

  const productIds = productRows.map((p) => p.id);
  let listings: MerchantListingInput[] = [];
  if (productIds.length > 0) {
    const { data: merchantProducts } = await supabase
      .from('merchant_products')
      .select('product_id, merchant_id, price, url')
      .in('product_id', productIds)
      .is('deleted_at', null)
      .eq('in_stock', true);
    const rows = (merchantProducts ?? []) as MerchantProductRow[];
    const merchantIds = [...new Set(rows.map((r) => r.merchant_id))];
    const nameByMerchantId = new Map<string, string>();
    if (merchantIds.length > 0) {
      const { data: merchants } = await supabase
        .from('merchants')
        .select('id, name')
        .in('id', merchantIds);
      for (const m of (merchants ?? []) as Array<{ id: string; name: string }>) {
        nameByMerchantId.set(m.id, m.name);
      }
    }
    const slugById = new Map(productRows.map((p) => [p.id, p.slug]));
    for (const row of rows) {
      const slug = slugById.get(row.product_id);
      if (!slug) continue;
      const price = typeof row.price === 'number' ? row.price : parseFloat(String(row.price));
      if (!Number.isFinite(price) || price <= 0) continue;
      listings.push({
        productSlug: slug,
        store: nameByMerchantId.get(row.merchant_id) ?? 'Unknown store',
        price,
        url: row.url,
      });
    }
  }
  void idBySlug;
  return optimizeShoppingList(items, listings);
}

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'tools.list-optimizer' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`tools:list-optimizer:${auth.userId}`, 30);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const listId = request.nextUrl.searchParams.get('list_id');

    if (listId) {
      const { data: list, error: listError } = await supabase
        .from('shopping_lists')
        .select(LIST_COLUMNS)
        .eq('id', listId)
        .eq('user_id', auth.userId)
        .maybeSingle();
      if (listError) {
        if (isMissingTableOrColumn(listError)) {
          return apiSuccess({ lists: [], listsEnabled: false });
        }
        return internalError('Failed to fetch shopping list');
      }
      if (!list) return validationError('list_id does not match one of your shopping lists.');
      const { data: itemRows, error: itemsError } = await supabase
        .from('shopping_list_items')
        .select(ITEM_COLUMNS)
        .eq('list_id', listId)
        .order('product_slug', { ascending: true });
      if (itemsError) {
        if (isMissingTableOrColumn(itemsError)) {
          return apiSuccess({ lists: [], listsEnabled: false });
        }
        return internalError('Failed to fetch shopping list items');
      }
      const items = ((itemRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
        productSlug: String(row.product_slug),
        quantity: typeof row.quantity === 'number' ? row.quantity : 1,
      }));
      const optimization = await loadOptimization(supabase, items);
      return apiSuccess({ list, items, optimization, listsEnabled: true });
    }

    const { data, error } = await supabase
      .from('shopping_lists')
      .select(LIST_COLUMNS)
      .eq('user_id', auth.userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) {
      if (isMissingTableOrColumn(error)) {
        return apiSuccess({ lists: [], listsEnabled: false });
      }
      return internalError('Failed to fetch shopping lists');
    }
    return apiSuccess({ lists: data ?? [], listsEnabled: true });
  } catch (err) {
    logApiError(err, { request, route: 'tools.list-optimizer.get', status: 500 });
    return internalError('Failed to fetch shopping lists');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'tools.list-optimizer.create' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`tools:list-optimizer:${auth.userId}`, 30);
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => null);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 100) {
      return validationError('name is required and must be at most 100 characters.');
    }
    let items;
    try {
      items = normalizeListItems(body?.items);
    } catch (err) {
      // User input error (422) — not a server error, so not logged to error_log.
      return validationError(err instanceof Error ? err.message : 'Invalid items.');
    }

    const supabase = await createSupabaseServerClient();

    // Every slug must match a real catalog product — an unknown slug
    // is rejected, never silently optimized.
    const slugs = items.map((i) => i.productSlug);
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('slug')
      .in('slug', slugs);
    if (productsError) return internalError('Failed to verify products');
    const known = new Set(((products ?? []) as Array<{ slug: string }>).map((p) => p.slug));
    const unknown = slugs.filter((s) => !known.has(s));
    if (unknown.length > 0) {
      return validationError(`Unknown product slug(s): ${unknown.join(', ')}.`);
    }

    const { data: list, error: listError } = await supabase
      .from('shopping_lists')
      .insert({ user_id: auth.userId, name })
      .select(LIST_COLUMNS)
      .single();
    if (listError) {
      if (isMissingTableOrColumn(listError)) {
        return serviceUnavailable(
          'Shopping lists are not set up yet — the owner still needs to run migration 033 once.'
        );
      }
      return internalError('Failed to save shopping list');
    }

    const { error: itemsError } = await supabase.from('shopping_list_items').insert(
      items.map((i) => ({
        list_id: (list as Record<string, unknown>).id,
        product_slug: i.productSlug,
        quantity: i.quantity,
      }))
    );
    if (itemsError) {
      if (isMissingTableOrColumn(itemsError)) {
        return serviceUnavailable(
          'Shopping lists are not set up yet — the owner still needs to run migration 033 once.'
        );
      }
      return internalError('Failed to save shopping list items');
    }

    const optimization = await loadOptimization(supabase, items);
    return apiSuccess({ list, items, optimization, listsEnabled: true }, 201);
  } catch (err) {
    logApiError(err, { request, route: 'tools.list-optimizer.post', status: 500 });
    return internalError('Failed to save shopping list');
  }
}
