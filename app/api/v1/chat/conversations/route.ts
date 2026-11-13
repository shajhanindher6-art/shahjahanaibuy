/**
 * API v1 chat conversations endpoint.
 * GET  /api/v1/chat/conversations — list the authenticated user's conversations.
 * POST /api/v1/chat/conversations — create a new conversation (auth required).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError, rateLimited } from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { logApiError } from '@/lib/api/error-logging';
// Section 19, Phase 1 (§12 #13) — per-user daily AI quota.
import { checkAiUserQuotaAsync } from '@/services/ai-engine/usage';
import { getConversations, createConversation } from '@/services/chat';

// Section 19, Phase 1 (§12 #10) — expensive inline AI work runs under
// maxDuration 60 (matching the 5 cron routes), not the platform default.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'chat.conversations' });
  const startedAt = Date.now();
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`chat.conversations:${getClientIp(request)}`, 120);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  // Section 19, Phase 1 (§12 #13) — per-user AI quota (300
  // calls/day across AI routes, in-memory). The per-IP limit above
  // stays as the floor; this binds one signed-in user, not the IP.
  const quota = await checkAiUserQuotaAsync(auth.userId);
  if (!quota.allowed) {
    return rateLimited('Daily AI usage limit reached. Try again tomorrow.', {
      resetAt: quota.resetAt,
    });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const conversations = await getConversations(supabase, auth.userId);

    return apiSuccess(conversations);
  } catch (err) {
    logApiError(err, { request, route: 'chat.conversations', status: 500, startedAt });
    return internalError('Failed to fetch conversations');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'chat.conversations.create' });
  const startedAt = Date.now();
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`chat.conversations:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  // Section 19, Phase 1 (§12 #13) — per-user AI quota (300
  // calls/day across AI routes, in-memory). The per-IP limit above
  // stays as the floor; this binds one signed-in user, not the IP.
  const quota = await checkAiUserQuotaAsync(auth.userId);
  if (!quota.allowed) {
    return rateLimited('Daily AI usage limit reached. Try again tomorrow.', {
      resetAt: quota.resetAt,
    });
  }

  try {
    const body = await request.json();
    const { title } = body ?? {};

    const supabase = await createSupabaseServerClient();
    const conversation = await createConversation(
      supabase,
      auth.userId,
      typeof title === 'string' && title.trim() !== '' ? title : undefined
    );

    if (!conversation) {
      return internalError('Failed to create conversation');
    }

    return apiSuccess(conversation, 201);
  } catch (err) {
    logApiError(err, { request, route: 'chat.conversations.create', status: 500, startedAt });
    return internalError('Failed to create conversation');
  }
}
