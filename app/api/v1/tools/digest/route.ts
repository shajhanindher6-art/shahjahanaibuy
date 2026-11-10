/**
 * API v1 price-drop digest — Section 7, item 10.
 * GET  /api/v1/tools/digest — the signed-in user's price-drop digest
 *        for their WATCHED products only (active alerts), over the
 *        last 24h (daily) or 7d (weekly). Frequency comes from
 *        ?frequency= or the saved preference (weekly by default).
 * POST /api/v1/tools/digest — save the digest preference (frequency
 *        daily/weekly, is_active). One preference per user.
 *
 * Fail-safe: until migration 033 (digest_preferences) runs, POST
 * returns 503 and GET still builds the digest from the user's alerts
 * with the weekly default. A product the user does not watch never
 * appears; a watched product with no recent drop is simply absent.
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
import { getAlerts } from '@/services/alerts';
import {
  buildPriceDropDigest,
  DIGEST_BASELINE_DAYS,
  type DigestFrequency,
} from '@/lib/price-drop-digest';

export const dynamic = 'force-dynamic';

const PREF_COLUMNS = 'id, user_id, frequency, is_active';

function isMissingTableOrColumn(error: unknown): boolean {
  if (isMissingTableError(error)) return true;
  const e = error as { code?: unknown; message?: unknown } | null;
  if (e?.code === '42703') return true;
  return typeof e?.message === 'string' && /column .* does not exist/i.test(e.message);
}

function parseFrequency(value: string | null): DigestFrequency | null {
  if (value === 'daily' || value === 'weekly') return value;
  return null;
}

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'tools.digest' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`tools:digest:${auth.userId}`, 30);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();

    // Saved preference (fail-safe: missing table → weekly default).
    let frequency: DigestFrequency = 'weekly';
    let isActive = true;
    let preferencesEnabled = true;
    const { data: pref, error: prefError } = await supabase
      .from('digest_preferences')
      .select(PREF_COLUMNS)
      .eq('user_id', auth.userId)
      .maybeSingle();
    if (prefError) {
      if (isMissingTableOrColumn(prefError)) {
        preferencesEnabled = false;
      }
    } else if (pref) {
      const row = pref as Record<string, unknown>;
      frequency = parseFrequency(typeof row.frequency === 'string' ? row.frequency : null) ?? 'weekly';
      isActive = row.is_active !== false;
    }
    const requested = parseFrequency(request.nextUrl.searchParams.get('frequency'));
    if (requested) frequency = requested;

    if (!isActive) {
      return apiSuccess({
        digest: null,
        preference: { frequency, isActive: false },
        preferencesEnabled,
        digestEnabled: true,
        note: 'Your digest is paused. Turn it back on to see price drops for your watched products.',
      });
    }

    // Watched products ONLY: the user's active alerts.
    const alerts = await getAlerts(supabase, auth.userId);
    const watchedIds = [...new Set(alerts.filter((a) => a.active).map((a) => a.productId))];
    if (watchedIds.length === 0) {
      return apiSuccess({
        digest: { frequency, windowDays: frequency === 'daily' ? 1 : 7, generatedAt: new Date().toISOString(), watchedCount: 0, deals: [] },
        preference: { frequency, isActive: true },
        preferencesEnabled,
        digestEnabled: true,
        note: 'You are not watching any products yet. Set a price-drop alert on a product and its drops will appear here.',
      });
    }

    const { data: products } = await supabase
      .from('products')
      .select('id, slug, name')
      .in('id', watchedIds);
    const productById = new Map<string, { slug: string; name: string | null }>();
    for (const p of (products ?? []) as Array<{ id: string; slug: string; name: string | null }>) {
      productById.set(p.id, { slug: p.slug, name: p.name });
    }

    const cutoff = new Date(Date.now() - DIGEST_BASELINE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: historyRows } = await supabase
      .from('price_history')
      .select('product_id, price, recorded_at')
      .in('product_id', watchedIds)
      .gte('recorded_at', cutoff)
      .order('recorded_at', { ascending: true })
      .limit(2000);
    const history = ((historyRows ?? []) as Array<Record<string, unknown>>)
      .map((row) => ({
        productId: String(row.product_id),
        price: typeof row.price === 'number' ? row.price : parseFloat(String(row.price)),
        recordedAt: String(row.recorded_at),
      }))
      .filter((p) => Number.isFinite(p.price));

    const digest = buildPriceDropDigest(
      watchedIds.map((id) => ({
        productId: id,
        productSlug: productById.get(id)?.slug ?? null,
        productName: productById.get(id)?.name ?? null,
      })),
      history,
      frequency
    );

    return apiSuccess({
      digest,
      preference: { frequency, isActive: true },
      preferencesEnabled,
      digestEnabled: true,
    });
  } catch {
    return internalError('Failed to build price-drop digest');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'tools.digest.preference' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`tools:digest:${auth.userId}`, 30);
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => null);
    const frequency = parseFrequency(
      typeof body?.frequency === 'string' ? body.frequency : null
    );
    if (!frequency) {
      return validationError("frequency must be one of: 'daily', 'weekly'.");
    }
    const isActive = body?.is_active === undefined ? true : body.is_active === true;

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('digest_preferences')
      .upsert(
        { user_id: auth.userId, frequency, is_active: isActive },
        { onConflict: 'user_id' }
      )
      .select(PREF_COLUMNS)
      .single();
    if (error) {
      if (isMissingTableOrColumn(error)) {
        return serviceUnavailable(
          'Digest preferences are not set up yet — the owner still needs to run migration 033 once.'
        );
      }
      return internalError('Failed to save digest preference');
    }
    return apiSuccess({ preference: data, preferencesEnabled: true });
  } catch {
    return internalError('Failed to save digest preference');
  }
}
