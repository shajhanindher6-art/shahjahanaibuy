/**
 * API v1 live shopping sessions endpoint.
 * GET  /api/v1/live-sessions — public list (soonest first), with a
 *        derived status per session. Missing table (migration 033
 *        not run) → { sessions: [], liveEnabled: false }.
 * POST /api/v1/live-sessions — admin-only create. Sessions are
 *        scheduled records only: no stream is hosted or embedded,
 *        no viewer/sales counts exist, and status is always derived
 *        from dates + stream_url presence (see lib/live-sessions.ts).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  conflict,
  internalError,
  serviceUnavailable,
  validationError,
} from '@/lib/api/responses';
import { logger } from '@/lib/config/logger';
import {
  logApiRequest,
  requireAdmin,
  rateLimitResponse,
  getClientIp,
} from '@/lib/api/middleware';
import {
  getLiveSessions,
  isMissingTableError,
  isValidLiveSessionSlug,
} from '@/lib/live-sessions';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'live-sessions' });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`live-sessions:${getClientIp(request)}`, 120);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const { sessions, liveEnabled } = await getLiveSessions(supabase);
    return apiSuccess(sessions, 200, { liveEnabled });
  } catch (err) {
    logger.error('[live-sessions] unexpected error', { error: err instanceof Error ? err.message : err });
    return internalError('Failed to fetch live shopping sessions');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'live-sessions' });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`live-sessions:${getClientIp(request)}`, 30);
  if (limited) return limited;

  try {
    const admin = await requireAdmin(request);
    if ('error' in admin) return admin.error;

    const body = await request.json().catch(() => null);
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const slug = typeof body?.slug === 'string' ? body.slug.trim().toLowerCase() : '';
    const startsAt = typeof body?.startsAt === 'string' ? body.startsAt.trim() : '';
    const endsAt = typeof body?.endsAt === 'string' && body.endsAt.trim() ? body.endsAt.trim() : null;
    const streamUrl =
      typeof body?.streamUrl === 'string' && body.streamUrl.trim() ? body.streamUrl.trim() : null;
    const hostNote =
      typeof body?.hostNote === 'string' && body.hostNote.trim() ? body.hostNote.trim() : null;
    const productIds = Array.isArray(body?.productIds)
      ? (body.productIds as unknown[]).filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      : [];

    if (!title) return validationError('A session title is required.');
    if (!slug || !isValidLiveSessionSlug(slug)) {
      return validationError('Slug must be lowercase letters, digits and single hyphens.');
    }
    const startsMs = Date.parse(startsAt);
    if (Number.isNaN(startsMs)) return validationError('startsAt must be a valid date.');
    if (endsAt) {
      const endsMs = Date.parse(endsAt);
      if (Number.isNaN(endsMs)) return validationError('endsAt must be a valid date.');
      if (endsMs <= startsMs) return validationError('endsAt must be after startsAt.');
    }
    if (streamUrl) {
      try {
        const u = new URL(streamUrl);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad protocol');
      } catch {
        return validationError('streamUrl must be a valid http(s) URL.');
      }
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('live_shopping_sessions')
      .insert({
        title,
        slug,
        starts_at: new Date(startsMs).toISOString(),
        ends_at: endsAt ? new Date(Date.parse(endsAt)).toISOString() : null,
        stream_url: streamUrl,
        host_note: hostNote,
      })
      .select('id, title, slug, starts_at, ends_at, stream_url, host_note, created_at')
      .single();
    if (error) {
      if (isMissingTableError(error)) {
        return serviceUnavailable(
          'Live shopping sessions are not set up yet — the owner still needs to run migration 033 in Supabase once.'
        );
      }
      if (error.code === '23505') return conflict('A session with this slug already exists.');
      logger.error('[live-sessions] insert error', { error: error instanceof Error ? error.message : error });
      return internalError('Failed to create live shopping session');
    }

    // Link catalog products (optional). A failed link insert never
    // fails the session itself — the session is the record; links
    // can be re-added. Only product IDs that resolve are linked:
    // the link table's FK enforces this, so unknown IDs are skipped
    // silently rather than inventing a product.
    if (productIds.length > 0) {
      const { error: linkError } = await supabase.from('live_session_products').insert(
        productIds.map((productId) => ({ session_id: data.id, product_id: productId }))
      );
      if (linkError) {
        logger.error('[live-sessions] product link error', { error: linkError instanceof Error ? linkError.message : linkError });
      }
    }

    return apiSuccess(data, 201, { liveEnabled: true });
  } catch (err) {
    logger.error('[live-sessions] unexpected error', { error: err instanceof Error ? err.message : err });
    return internalError('Failed to create live shopping session');
  }
}
