/**
 * API v1 saved searches endpoint (Section 15, C2).
 * GET    /api/v1/saved-searches — list the caller's saved searches, newest first.
 * POST   /api/v1/saved-searches — save the current search (name + query string).
 * PATCH  /api/v1/saved-searches?id=<id> — turn match notifications on/off
 *          for one saved search (Section 16, #32; migration 042).
 * DELETE /api/v1/saved-searches?id=<id> — delete one of the caller's saved searches.
 *
 * Auth required on all three. A user can only ever see, save, or
 * delete their own rows: the route authenticates, the service
 * scopes every query with .eq('user_id', auth.userId), and RLS
 * (migration 039) enforces auth.uid() = user_id. Writes go through
 * the authenticated server client, NOT the service-role client —
 * RLS is the own-only enforcement, so nothing here can write on
 * another user's behalf.
 *
 * Migration 039 is written NOT applied: until the owner applies
 * it, POST answers 503 "Saved searches are not available yet"
 * and GET answers an honest empty list (no table → no saved
 * search could exist). Nothing here ever invents a saved search.
 * Per-user cap: 50 saved searches (MAX_SAVED_SEARCHES).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  badRequest,
  conflict,
  internalError,
  notFound,
  serviceUnavailable,
} from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import {
  MAX_SAVED_SEARCHES,
  createSavedSearch,
  deleteSavedSearch,
  listSavedSearches,
  setSavedSearchNotify,
  validateSavedSearchInput,
} from '@/services/saved-searches';

import { logApiError } from '@/lib/api/error-logging';
// Section 15, C2 — live per-request data: never statically prerendered.
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'saved-searches' });
  // Rate limit: 120 requests/min per IP (same as GET /api/v1/digests).
  const limited = await rateLimitResponse(`saved-searches:${getClientIp(request)}`, 120);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const saved = await listSavedSearches(supabase, auth.userId);
    return apiSuccess(saved, 200, { total: saved.length });
  } catch (err) {
    logApiError(err, { request, route: 'saved-searches.get', status: 500 });
    return internalError('Failed to fetch saved searches');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'saved-searches.create' });
  // Rate limit: 30 requests/min per IP (same as POST /api/v1/wishlists).
  const limited = await rateLimitResponse(`saved-searches:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json().catch(() => null);
    const validated = validateSavedSearchInput(body);
    if (!validated.ok) return badRequest(validated.error);

    const supabase = await createSupabaseServerClient();

    // Per-user cap: 50 saved searches. A list read is cheap and
    // the cap is a UX guard, not a security boundary (the UNIQUE
    // name index is the DB-level guard) — a race that overshoots
    // by one is harmless.
    const existing = await listSavedSearches(supabase, auth.userId);
    if (existing.length >= MAX_SAVED_SEARCHES) {
      return conflict(
        `You can save up to ${MAX_SAVED_SEARCHES} searches. Delete one to save a new search.`
      );
    }

    const result = await createSavedSearch(supabase, auth.userId, {
      name: validated.name,
      query: validated.query,
    });
    if ('error' in result) {
      if (result.error === 'missing-table') {
        return serviceUnavailable('Saved searches are not available yet');
      }
      if (result.error === 'duplicate') {
        return conflict('A saved search with this name already exists');
      }
      if (result.error === 'invalid') {
        return badRequest('name and query are required');
      }
      return internalError('Failed to save search');
    }
    return apiSuccess(result.savedSearch, 201);
  } catch (err) {
    logApiError(err, { request, route: 'saved-searches.post', status: 500 });
    return internalError('Failed to save search');
  }
}

export async function PATCH(request: NextRequest) {
  logApiRequest(request, { endpoint: 'saved-searches.notify' });
  // Rate limit: 30 requests/min per IP.
  const limited = await rateLimitResponse(`saved-searches:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const id = request.nextUrl.searchParams.get('id');
  if (!id) return badRequest('id is required');

  const body = await request.json().catch(() => null);
  if (!body || typeof body.notifyOnMatch !== 'boolean') {
    return badRequest('notifyOnMatch (boolean) is required');
  }

  try {
    const supabase = await createSupabaseServerClient();
    const result = await setSavedSearchNotify(supabase, auth.userId, id, body.notifyOnMatch);
    if ('error' in result) {
      if (result.error === 'missing-table') {
        return serviceUnavailable(
          'Saved-search notifications are not available yet — migration 042 has not been applied.'
        );
      }
      if (result.error === 'not-found') {
        return notFound('Saved search not found or not owned by user');
      }
      return internalError('Failed to update saved search notifications');
    }
    return apiSuccess(result.savedSearch, 200);
  } catch (err) {
    logApiError(err, { request, route: 'saved-searches.patch', status: 500 });
    return internalError('Failed to update saved search notifications');
  }
}

export async function DELETE(request: NextRequest) {
  logApiRequest(request, { endpoint: 'saved-searches.delete' });
  // Rate limit: 30 requests/min per IP.
  const limited = await rateLimitResponse(`saved-searches:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const id = request.nextUrl.searchParams.get('id');
  if (!id) return badRequest('id is required');

  try {
    const supabase = await createSupabaseServerClient();
    const deleted = await deleteSavedSearch(supabase, auth.userId, id);
    // 404 covers "does not exist" and "belongs to someone else"
    // identically, so existence never leaks across users.
    if (!deleted) return notFound('Saved search not found or not owned by user');
    return apiSuccess({ id, deleted: true });
  } catch (err) {
    logApiError(err, { request, route: 'saved-searches.delete', status: 500 });
    return internalError('Failed to delete saved search');
  }
}
