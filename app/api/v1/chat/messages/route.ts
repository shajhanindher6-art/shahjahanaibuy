/**
 * API v1 chat messages endpoint.
 * GET  /api/v1/chat/messages — list messages in a conversation (auth required).
 * POST /api/v1/chat/messages — send a message and receive an AI response (auth required).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth } from '@/lib/api/middleware';
import {
  getChatMessages,
  saveMessage,
  generateChatResponse,
} from '@/services/chat';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'chat.messages' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const { searchParams } = request.nextUrl;
    const conversationId = searchParams.get('conversationId');

    if (!conversationId || conversationId.trim() === '') {
      return badRequest('conversationId is required');
    }

    const supabase = await createSupabaseServerClient();
    const messages = await getChatMessages(supabase, conversationId, auth.userId);

    return apiSuccess(messages);
  } catch {
    return internalError('Failed to fetch chat messages');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'chat.messages.send' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

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
  } catch {
    return internalError('Failed to send chat message');
  }
}
