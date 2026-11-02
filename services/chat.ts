/**
 * AI Shopping Chat Assistant service.
 * Handles conversation management and AI-powered responses.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { FALLBACK_REGION, type Region } from '@/lib/region';
import { parseSearchIntent } from './ai-search';
import { stripBudgetFromQuery } from './currency';
import { compareAssistant, dealsAssistant, recommendAssistant } from './personal-assistant';

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  metadata: ChatMetadata | null;
  createdAt: string;
}

export interface ChatMetadata {
  products?: Array<{
    id: string;
    name: string;
    slug: string;
    brand: string | null;
    imageUrl: string | null;
    price: number | null;
  }>;
  comparison?: string;
  budget?: number;
  intent?: string;
}

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export async function createConversation(
  supabase: AnySupabaseClient,
  userId: string,
  title = 'New Conversation'
): Promise<Conversation | null> {
  try {
    const { data, error } = await supabase
      .from('chat_conversations')
      .insert({ user_id: userId, title })
      .select('id, user_id, title, created_at, updated_at')
      .maybeSingle();

    if (error || !data) {
      if (error) logger.warn('createConversation: failed', { error: error.message });
      return null;
    }

    const row = data as Record<string, unknown>;
    return {
      id: row.id as string,
      userId: row.user_id as string,
      title: row.title as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  } catch (err) {
    logger.error('createConversation: unexpected error', { error: String(err) });
    return null;
  }
}

export async function getConversations(
  supabase: AnySupabaseClient,
  userId: string,
  limit = 20
): Promise<Conversation[]> {
  try {
    const { data, error } = await supabase
      .from('chat_conversations')
      .select('id, user_id, title, created_at, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(Math.min(50, limit));

    if (error || !data) {
      if (error) logger.warn('getConversations: query failed', { error: error.message });
      return [];
    }

    return (data as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      userId: row.user_id as string,
      title: row.title as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));
  } catch (err) {
    logger.error('getConversations: unexpected error', { error: String(err) });
    return [];
  }
}

export async function getChatMessages(
  supabase: AnySupabaseClient,
  conversationId: string,
  userId: string
): Promise<ChatMessage[]> {
  try {
    const { data: conv } = await supabase
      .from('chat_conversations')
      .select('user_id')
      .eq('id', conversationId)
      .maybeSingle();

    if (!conv || (conv as Record<string, unknown>).user_id !== userId) {
      return [];
    }

    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, conversation_id, role, content, metadata, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(100);

    if (error || !data) {
      if (error) logger.warn('getChatMessages: query failed', { error: error.message });
      return [];
    }

    return (data as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      conversationId: row.conversation_id as string,
      role: row.role as 'user' | 'assistant',
      content: row.content as string,
      metadata: row.metadata as ChatMetadata | null,
      createdAt: row.created_at as string,
    }));
  } catch (err) {
    logger.error('getChatMessages: unexpected error', { error: String(err) });
    return [];
  }
}

export async function saveMessage(
  supabase: AnySupabaseClient,
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  metadata: ChatMetadata | null = null
): Promise<void> {
  try {
    await supabase.from('chat_messages').insert({
      conversation_id: conversationId,
      role,
      content,
      metadata: metadata as unknown as Record<string, unknown> | null,
    });

    await supabase
      .from('chat_conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId);
  } catch (err) {
    logger.error('saveMessage: unexpected error', { error: String(err) });
  }
}

export interface ChatResponseOptions {
  /**
   * Visitor region for country-aware prices. The floating widget
   * sends its RegionProvider country; the dashboard chat (which
   * has no region) omits it and gets the US fallback, i.e. plain
   * "$999.00" prices exactly as before.
   */
  region?: Region;
}

/**
 * Route one message to an intent handler. The handlers live in
 * services/personal-assistant.ts, which enforces the assistant's
 * hard rules: no demo/unpriced recommendations, budget as a hard
 * filter, region-aware prices, real price history, and real
 * coupons/cashback only. `conversationHistory` is accepted for
 * API compatibility (the dashboard chat passes it) but the
 * engine is stateless by design — follow-ups work because the
 * widget re-sends the question WITH product names included.
 */
export async function generateChatResponse(
  supabase: AnySupabaseClient,
  userMessage: string,
  conversationHistory: ChatMessage[],
  options: ChatResponseOptions = {}
): Promise<{ content: string; metadata: ChatMetadata | null }> {
  void conversationHistory;
  const region = options.region ?? FALLBACK_REGION;
  const intent = parseSearchIntent(userMessage);
  const lower = userMessage.toLowerCase();

  if (lower.includes('compare') || lower.includes('vs') || lower.includes('versus')) {
    return compareAssistant(supabase, userMessage, intent, region);
  }

  if (lower.includes('deal') || lower.includes('discount') || lower.includes('sale')) {
    return dealsAssistant(supabase, region);
  }

  // Budget and general product search share one handler: the old
  // budget intent only delegated to the product-search handler
  // anyway, and both need the same priced-only + hard-budget
  // filtering. The search terms still strip the whole budget
  // expression so "K PKR" never leaks into product matching.
  const searchTerms = stripBudgetFromQuery(userMessage)
    .replace(/best\s+/gi, '')
    .replace(/top\s+/gi, '')
    .trim();
  return recommendAssistant(supabase, intent, searchTerms, region);
}

