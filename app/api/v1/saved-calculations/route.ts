/**
 * API v1 saved calculations endpoint (Section 16, #36).
 * GET    /api/v1/saved-calculations — list the caller's saved calculations, newest first.
 * POST   /api/v1/saved-calculations — save a calculator's inputs (tool + label + params).
 * DELETE /api/v1/saved-calculations?id=<id> — delete one of the caller's saved calculations.
 *
 * Auth required on all three. A user can only ever see, save, or
 * delete their own rows: the route authenticates, the service
 * scopes every query with .eq('user_id', auth.userId), and RLS
 * (migration 043) enforces auth.uid() = user_id. Writes go through
 * the authenticated server client, NOT the service-role client.
 *
 * Migration 043 is written NOT applied: until the owner applies
 * it, POST answers 503 "Saved calculations are not available yet"
 * and GET answers an honest empty list (no table → no saved
 * calculation could exist). The shareable link still works without
 * the table — it is just the tool URL with the inputs in it.
 * Per-user cap: 50 saved calculations (MAX_SAVED_CALCULATIONS).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  badRequest,
  internalError,
  notFound,
  serviceUnavailable,
} from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import {
  MAX_SAVED_CALCULATIONS,
  createSavedCalculation,
  deleteSavedCalculation,
  listSavedCalculations,
  validateSavedCalculationInput,
} from '@/services/saved-calculations';

// Live per-request data: never statically prerendered.
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'saved-calculations' });
  const limited = await rateLimitResponse(`saved-calculations:${getClientIp(request)}`, 120);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const saved = await listSavedCalculations(supabase, auth.userId);
    return apiSuccess(saved, 200, { total: saved.length });
  } catch {
    return internalError('Failed to fetch saved calculations');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'saved-calculations.create' });
  const limited = await rateLimitResponse(`saved-calculations:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json().catch(() => null);
    const validated = validateSavedCalculationInput(body);
    if (!validated.ok) return badRequest(validated.error);

    const supabase = await createSupabaseServerClient();

    const existing = await listSavedCalculations(supabase, auth.userId);
    if (existing.length >= MAX_SAVED_CALCULATIONS) {
      return badRequest(
        `You can save up to ${MAX_SAVED_CALCULATIONS} calculations. Delete one to save a new calculation.`
      );
    }

    const result = await createSavedCalculation(supabase, auth.userId, {
      tool: validated.tool,
      label: validated.label,
      params: validated.params,
    });
    if ('error' in result) {
      if (result.error === 'missing-table') {
        return serviceUnavailable(
          'Saved calculations are not available yet — migration 043 has not been applied.'
        );
      }
      if (result.error === 'invalid') {
        return badRequest('tool, label and params are required');
      }
      return internalError('Failed to save calculation');
    }
    return apiSuccess(result.savedCalculation, 201);
  } catch {
    return internalError('Failed to save calculation');
  }
}

export async function DELETE(request: NextRequest) {
  logApiRequest(request, { endpoint: 'saved-calculations.delete' });
  const limited = await rateLimitResponse(`saved-calculations:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const id = request.nextUrl.searchParams.get('id');
  if (!id) return badRequest('id is required');

  try {
    const supabase = await createSupabaseServerClient();
    const deleted = await deleteSavedCalculation(supabase, auth.userId, id);
    // 404 covers "does not exist" and "belongs to someone else"
    // identically, so existence never leaks across users.
    if (!deleted) return notFound('Saved calculation not found or not owned by user');
    return apiSuccess({ id, deleted: true });
  } catch {
    return internalError('Failed to delete saved calculation');
  }
}
