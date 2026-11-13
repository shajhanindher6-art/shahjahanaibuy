/**
 * API v1 agent memory endpoint (S5#1).
 * GET    /api/v1/agent/memory — the signed-in user's agent memory.
 * PUT    /api/v1/agent/memory — save preferences / record a seen
 *        product. Requires explicit consent (memory is permission-
 *        gated): without an existing row, `consent: true` is
 *        required to create one. `consent: false` deletes the row.
 * DELETE /api/v1/agent/memory — delete the user's memory entirely.
 *
 * Fail-safe: until migration 027 is run, GET returns
 * { memory: null, setupRequired: true } and PUT/DELETE return an
 * honest "not set up yet" error — never a crash, never fake data.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, requireAuth } from '@/lib/api/middleware';
import {
  applyPreferencesUpdate,
  emptyMemory,
  mergeSeenProducts,
  validatePreferences,
  type AgentPreferences,
} from '@/lib/agent-memory';
import { isMissingTableError, mapMemoryRow } from '../shared';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

const MEMORY_COLUMNS =
  'id, user_id, preferences, seen_product_slugs, consent_granted_at, created_at, updated_at';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'agent.memory' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`agent-memory:${auth.userId}`, 30);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('agent_memory')
      .select(MEMORY_COLUMNS)
      .eq('user_id', auth.userId)
      .maybeSingle();

    if (error) {
      if (isMissingTableError(error)) {
        return apiSuccess({ memory: null, setupRequired: true });
      }
      return internalError('Failed to fetch agent memory');
    }
    if (!data) return apiSuccess({ memory: null, setupRequired: false });
    return apiSuccess({ memory: mapMemoryRow(data as Record<string, unknown>), setupRequired: false });
  } catch (err) {
    logApiError(err, { request, route: 'agent.memory.get', status: 500 });
    return internalError('Failed to fetch agent memory');
  }
}

export async function PUT(request: NextRequest) {
  logApiRequest(request, { endpoint: 'agent.memory.update' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`agent-memory:${auth.userId}`, 30);
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => null);
    const preferences = (body?.preferences ?? {}) as AgentPreferences;
    const addSeenSlug = typeof body?.addSeenSlug === 'string' ? body.addSeenSlug : null;
    const clearSeen = body?.clearSeen === true;
    const consent = body?.consent as unknown;

    const prefsValidation = validatePreferences(preferences);
    if (!prefsValidation.ok) {
      return badRequest(prefsValidation.errors.join(' '));
    }

    const supabase = await createSupabaseServerClient();

    // Turning memory off deletes the whole record — the delete
    // option the permission gate promises.
    if (consent === false) {
      const { error } = await supabase.from('agent_memory').delete().eq('user_id', auth.userId);
      if (error && !isMissingTableError(error)) {
        return internalError('Failed to delete agent memory');
      }
      return apiSuccess({ memory: null, deleted: true });
    }

    const { data: existing, error: fetchError } = await supabase
      .from('agent_memory')
      .select(MEMORY_COLUMNS)
      .eq('user_id', auth.userId)
      .maybeSingle();

    if (fetchError) {
      if (isMissingTableError(fetchError)) {
        return internalError('Agent memory is not set up yet — migration 027 has not been run');
      }
      return internalError('Failed to update agent memory');
    }

    // No row yet: memory may only be created with explicit consent.
    if (!existing && consent !== true) {
      return badRequest('Memory is off — pass consent: true to turn it on and save preferences.');
    }

    const now = new Date().toISOString();
    const current = existing
      ? mapMemoryRow(existing as Record<string, unknown>)
      : emptyMemory(auth.userId);
    const nextPreferences = applyPreferencesUpdate(current.preferences, preferences);
    const nextSeen = clearSeen
      ? []
      : addSeenSlug
        ? mergeSeenProducts(current.seenProductSlugs, addSeenSlug)
        : current.seenProductSlugs;
    const consentGrantedAt =
      consent === true ? (current.consentGrantedAt ?? now) : current.consentGrantedAt;

    const payload = {
      user_id: auth.userId,
      preferences: nextPreferences,
      seen_product_slugs: nextSeen,
      consent_granted_at: consentGrantedAt,
      updated_at: now,
    };

    if (existing) {
      const { data, error } = await supabase
        .from('agent_memory')
        .update(payload)
        .eq('user_id', auth.userId)
        .select(MEMORY_COLUMNS)
        .maybeSingle();
      if (error || !data) return internalError('Failed to update agent memory');
      return apiSuccess({ memory: mapMemoryRow(data as Record<string, unknown>) });
    }

    const { data, error } = await supabase
      .from('agent_memory')
      .insert({ ...payload, created_at: now })
      .select(MEMORY_COLUMNS)
      .maybeSingle();
    if (error || !data) {
      if (error && isMissingTableError(error)) {
        return internalError('Agent memory is not set up yet — migration 027 has not been run');
      }
      return internalError('Failed to update agent memory');
    }
    return apiSuccess({ memory: mapMemoryRow(data as Record<string, unknown>) }, 201);
  } catch (err) {
    logApiError(err, { request, route: 'agent.memory.put', status: 500 });
    return internalError('Failed to update agent memory');
  }
}

export async function DELETE(request: NextRequest) {
  logApiRequest(request, { endpoint: 'agent.memory.delete' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`agent-memory:${auth.userId}`, 30);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from('agent_memory').delete().eq('user_id', auth.userId);
    if (error) {
      if (isMissingTableError(error)) {
        return internalError('Agent memory is not set up yet — migration 027 has not been run');
      }
      return internalError('Failed to delete agent memory');
    }
    return apiSuccess({ deleted: true });
  } catch (err) {
    logApiError(err, { request, route: 'agent.memory.delete', status: 500 });
    return internalError('Failed to delete agent memory');
  }
}
