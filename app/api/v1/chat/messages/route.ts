/**
 * API v1 chat messages endpoint.
 * GET  /api/v1/chat/messages — list messages in a conversation (auth required).
 * POST /api/v1/chat/messages — send a message and receive an AI response (auth required).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError, rateLimited } from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { logApiError } from '@/lib/api/error-logging';
// Section 19, Phase 1 (§12 #13) — per-user daily AI quota.
import { checkAiUserQuota } from '@/services/ai-engine/usage';
import {
  getChatMessages,
  saveMessage,
  generateChatResponse,
} from '@/services/chat';

// Section 19, Phase 1 (§12 #10) — expensive inline AI work runs under
// maxDuration 60 (matching the 5 cron routes), not the platform default.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'chat.messages' });
  const startedAt = Date.now();
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`chat.messages:${getClientIp(request)}`, 120);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  // Section 19, Phase 1 (§12 #13) — per-user AI quota (300
  // calls/day across AI routes, in-memory). The per-IP limit above
  // stays as the floor; this binds one signed-in user, not the IP.
  const quota = checkAiUserQuota(auth.userId);
  if (!quota.allowed) {
    return rateLimited('Daily AI usage limit reached. Try again tomorrow.', {
      resetAt: quota.resetAt,
    });
  }

  try {
    const { searchParams } = request.nextUrl;
    const conversationId = searchParams.get('conversationId');

    if (!conversationId || conversationId.trim() === '') {
      return badRequest('conversationId is required');
    }

    const supabase = await createSupabaseServerClient();
    const messages = await getChatMessages(supabase, conversationId, auth.userId);

    return apiSuccess(messages);
  } catch (err) {
    logApiError(err, { request, route: 'chat.messages', status: 500, startedAt });
    return internalError('Failed to fetch chat messages');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'chat.messages.send' });
  const startedAt = Date.now();
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`chat.messages:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  // Section 19, Phase 1 (§12 #13) — per-user AI quota (300
  // calls/day across AI routes, in-memory). The per-IP limit above
  // stays as the floor; this binds one signed-in user, not the IP.
  const quota = checkAiUserQuota(auth.userId);
  if (!quota.allowed) {
    return rateLimited('Daily AI usage limit reached. Try again tomorrow.', {
      resetAt: quota.resetAt,
    });
  }

  try {
    const body = await request.json();
    const { conversationId, message } = body ?? {};

    if (typeof conversationId !== 'string' || conversationId.trim() === '') {
      return badRequest('conversationId is required');
    }
    if (typeof message !== 'string' || message.trim() === '') {
      return badRequest('message is required');
    }

    const supabase = await createSupabaseServerClient();

    // Verify ownership and fetch conversation history.
    const history = await getChatMessages(supabase, conversationId, auth.userId);

    // Persist the user's message.
    await saveMessage(supabase, conversationId, 'user', message);

    // Generate the AI response using the full conversation history.
    const { content, metadata } = await generateChatResponse(
      supabase,
      message,
      history
    );

    // Persist the assistant's reply.
    await saveMessage(supabase, conversationId, 'assistant', content, metadata);

    return apiSuccess({ response: content, metadata });
  } catch (err) {
    logApiError(err, { request, route: 'chat.messages.send', status: 500, startedAt });
    return internalError('Failed to send chat message');
  }
}
