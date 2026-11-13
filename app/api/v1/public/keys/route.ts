/**
 * Public API key management (Section 4, item 18).
 * GET  /api/v1/public/keys — list the caller's own keys (redacted).
 * POST /api/v1/public/keys — create a key; the full key is returned
 *        exactly once in the response and never stored or shown again.
 *
 * Signed-in only (requireAuth). Keys are validated against the
 * SHA-256 hash stored in `api_keys` (migration 032) — the full key
 * never reaches the database and is never logged. Revocation is a
 * soft revoke (revoked_at) via DELETE /api/v1/public/keys/[keyId].
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, requireAuth } from '@/lib/api/middleware';
import {
  API_KEY_SCOPES,
  generateApiKey,
  redactApiKey,
  type ApiKeyScope,
} from '@/lib/api-keys';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

const MAX_NAME_LENGTH = 100;

function isScope(value: unknown): value is ApiKeyScope {
  return typeof value === 'string' && (API_KEY_SCOPES as readonly string[]).includes(value);
}

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'public.keys.list' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`public-keys:${auth.userId}`, 30);
  if (limited) return limited;

  const service = createSupabaseServiceClient();
  if (!service) {
    return internalError('Key management unavailable: service client not configured');
  }

  try {
    const { data, error } = await service
      .from('api_keys')
      .select('id, name, key_prefix, scopes, last_used_at, revoked_at, created_at')
      .eq('user_id', auth.userId)
      .order('created_at', { ascending: false });

    if (error || !data) return apiSuccess([]);
    return apiSuccess(data);
  } catch (err) {
    logApiError(err, { request, route: 'public.keys.get', status: 500 });
    return internalError('Failed to list API keys');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'public.keys.create' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`public-keys-create:${auth.userId}`, 10);
  if (limited) return limited;

  const service = createSupabaseServiceClient();
  if (!service) {
    return internalError('Key management unavailable: service client not configured');
  }

  try {
    const body = await request.json().catch(() => null);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) return badRequest('name is required');
    if (name.length > MAX_NAME_LENGTH) {
      return badRequest(`name must be ${MAX_NAME_LENGTH} characters or fewer`);
    }

    let scopes: ApiKeyScope[] = [...API_KEY_SCOPES];
    if (body?.scopes !== undefined) {
      if (!Array.isArray(body.scopes) || body.scopes.length === 0) {
        return badRequest('scopes must be a non-empty array');
      }
      if (!body.scopes.every(isScope)) {
        return badRequest(`scopes must be a subset of: ${API_KEY_SCOPES.join(', ')}`);
      }
      scopes = body.scopes;
    }

    const generated = generateApiKey();

    const { data, error } = await service
      .from('api_keys')
      .insert({
        user_id: auth.userId,
        name,
        key_prefix: generated.keyPrefix,
        key_hash: generated.keyHash,
        scopes,
      })
      .select('id, name, key_prefix, scopes, created_at')
      .single();

    if (error || !data) {
      return internalError('Failed to create API key (migration 032 may not be run yet)');
    }

    // The ONLY time the full key is ever returned. The caller must
    // store it now — it cannot be read back afterwards.
    return apiSuccess(
      {
        ...(data as Record<string, unknown>),
        key: generated.key,
        keyDisplay: redactApiKey(generated.key),
        warning:
          'Store this key now — it will never be shown again. Only its hash is stored.',
      },
      201
    );
  } catch (err) {
    logApiError(err, { request, route: 'public.keys.post', status: 500 });
    return internalError('Failed to create API key');
  }
}
