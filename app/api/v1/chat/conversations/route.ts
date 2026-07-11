/**
 * API v1 chat conversations endpoint.
 * GET  /api/v1/chat/conversations — list the authenticated user's conversations.
 * POST /api/v1/chat/conversations — create a new conversation (auth required).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth } from '@/lib/api/middleware';
import { getConversations, createConversation } from '@/services/chat';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'chat.conversations' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const conversations = await getConversations(supabase, auth.userId);

    return apiSuccess(conversations);
  } catch {
    return internalError('Failed to fetch conversations');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'chat.conversations.create' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

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
  } catch {
    return internalError('Failed to create conversation');
  }
}
