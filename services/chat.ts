/**
 * AI Shopping Chat Assistant service.
 * Handles conversation management and AI-powered responses.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { FALLBACK_REGION, type Region } from '@/lib/region';
import { parseSearchIntent } from './ai-search';
import { stripBudgetFromQuery } from './currency';
import {
  buyWaitAssistant,
  compareAssistant,
  competitivenessAssistant,
  couponsAssistant,
  dealsAssistant,
  prosConsAssistant,
  recommendAssistant,
} from './personal-assistant';
import { resolveFollowUpQuery } from '@/lib/deal-finder-stream';
import { appendSourceLabel, verifiedDataLabel } from '@/lib/ai-source-label';

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

// ---------------------------------------------------------------------------
// Conversational follow-ups (Section 19, Phase 5, §12 #56)
// ---------------------------------------------------------------------------

/**
 * Minimal conversation context carried across turns WITHIN a
 * session: the products the last assistant turn listed + the last
 * intent. No personal data beyond the session, no LLM: the context
 * is derived from the history the caller passes in (the dashboard
 * chat reads it from the DB conversation; the deal-finder route
 * passes the widget's turn history) and lives in the chat session,
 * not in the analysis services — the engine stays deterministic
 * and stateless at the service layer.
 */
export interface SessionContext {
  /** Product names from the last assistant turn (at most 3). */
  productNames: string[];
  /** Intent of the last assistant turn, when recorded. */
  lastIntent: string | null;
}

/**
 * Extract the session context from conversation history. Primary
 * source: the last assistant message's metadata.products (the
 * dashboard chat persists them). Fallback: parse the product names
 * out of the last assistant answer's own lines ("Best pick for you:
 * X", "• X (Brand) — ...") — the deal-finder route passes history
 * with metadata null, so its follow-ups resolve from the text the
 * engine itself wrote, never from a guess.
 */
export function extractSessionContext(history: ChatMessage[]): SessionContext {
  const productNames: string[] = [];
  let lastIntent: string | null = null;

  for (const m of history) {
    if (m.role !== 'assistant' || !m.metadata) continue;
    const names = (m.metadata.products ?? [])
      .map((p) => p.name)
      .filter((n): n is string => typeof n === 'string' && n.trim() !== '');
    if (names.length > 0) {
      productNames.length = 0;
      productNames.push(...names.slice(0, 3));
    }
    if (typeof m.metadata.intent === 'string' && m.metadata.intent !== '') {
      lastIntent = m.metadata.intent;
    }
  }

  if (productNames.length === 0) {
    const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant');
    if (lastAssistant) {
      const pick = /Best pick for you: ([^\n(]+)/.exec(lastAssistant.content);
      if (pick) productNames.push(pick[1].trim());
      const bulletWithBrand = /^• ([^(—\n]+?) \(/gm;
      const bulletPlain = /^• ([^—\n]+?) — /gm;
      for (const re of [bulletWithBrand, bulletPlain]) {
        let match: RegExpExecArray | null;
        while ((match = re.exec(lastAssistant.content)) !== null) {
          const name = match[1].trim();
          if (name !== '' && !productNames.includes(name)) productNames.push(name);
          if (productNames.length >= 3) break;
        }
        if (productNames.length >= 3) break;
      }
    }
  }

  return { productNames: productNames.slice(0, 3), lastIntent };
}

/**
 * Is this message a follow-up on the previous turn (rather than a
 * fresh, self-contained question)? A follow-up refers back ("and
 * the cheaper one?", "is it competitive?", "pros and cons?") — a
 * question that names its own budget or category ("cheapest laptop
 * under $1000?") is self-contained and must NOT be rewritten
 * against the previous products. Guard: an explicit back-reference,
 * or a short message with no budget expression in it.
 */
function isSessionFollowUp(message: string): boolean {
  const text = message.trim();
  if (text.length === 0 || text.length > 120) return false;
  if (/\b(and the|and its|and their|that one|this one|them|those|is se|aur|sasta dikhao|in mein|in me|us ka|is ka|yeh wala|ye wala)\b/i.test(text)) {
    return true;
  }
  // Bare follow-up phrases with no product, category or budget of
  // their own. "cheapest headphones" is NOT one (it names a
  // category and is a fresh question); "cheapest?" is.
  const bare = text
    .toLowerCase()
    .replace(/[?!.]+$/, '')
    .trim();
  return /^(cheapest|cheaper|best one|which one|which is the (cheapest|best)|pros and cons|is it (competitive|worth it)|is this price competitive|is the price competitive|compare them|compare these)$/.test(
    bare
  );
}

/**
 * Append the source label to a successful assistant answer
 * (Section 19, Phase 5, §12 #55). Every answer is computed from
 * verified recorded data, so the label reads as verified-data —
 * with the product's real freshness timestamp when the answer is
 * about a single product. Error/apology answers carry no label:
 * there is no answer to source.
 */
async function withSourceLabel(
  supabase: AnySupabaseClient,
  answer: { content: string; metadata: ChatMetadata | null }
): Promise<{ content: string; metadata: ChatMetadata | null }> {
  if (answer.content.startsWith('Sorry,')) return answer;
  let asOf: string | null = null;
  const products = answer.metadata?.products;
  if (products && products.length === 1) {
    try {
      const { data } = await supabase
        .from('products')
        .select('data_freshness')
        .eq('id', products[0].id)
        .maybeSingle();
      asOf = ((data as Record<string, unknown> | null)?.data_freshness as string | null) ?? null;
    } catch {
      asOf = null;
    }
  }
  return { ...answer, content: appendSourceLabel(answer.content, verifiedDataLabel(asOf)) };
}

/**
 * Route one message to an intent handler. The handlers live in
 * services/personal-assistant.ts, which enforces the assistant's
 * hard rules: no demo/unpriced recommendations, budget as a hard
 * filter, region-aware prices, real price history, and real
 * coupons/cashback only. `conversationHistory` is the session
 * context (Section 19, Phase 5, §12 #56): the engine itself stays
 * stateless — follow-ups are resolved against the last turn's
 * products BEFORE routing, using only the history the caller
 * passed in. The widget used to be the only surface that could do
 * this (its chips re-sent product names); the dashboard chat can
 * now do it too, from its saved conversation.
 */
export async function generateChatResponse(
  supabase: AnySupabaseClient,
  userMessage: string,
  conversationHistory: ChatMessage[],
  options: ChatResponseOptions = {}
): Promise<{ content: string; metadata: ChatMetadata | null }> {
  const region = options.region ?? FALLBACK_REGION;

  // Conversational follow-up: rewrite "and the cheaper one?" /
  // "is it competitive?" / "pros and cons?" against the products
  // the previous turn discussed, so the intent handlers see a
  // self-contained question. A fresh question passes through
  // unchanged.
  let effectiveMessage = userMessage;
  if (isSessionFollowUp(userMessage)) {
    const context = extractSessionContext(conversationHistory);
    if (context.productNames.length > 0) {
      effectiveMessage = resolveFollowUpQuery(userMessage, context.productNames);
    }
  }

  const intent = parseSearchIntent(effectiveMessage);
  const lower = effectiveMessage.toLowerCase();

  // Coupon / cashback intent first: "any coupon for MacBook?" and
  // "discount code" must reach couponsAssistant, not the compare
  // route ("vs" below) or the deals route ("discount" below) —
  // both would answer a different question than the one asked.
  if (
    lower.includes('coupon') ||
    lower.includes('cashback') ||
    lower.includes('promo code') ||
    lower.includes('discount code') ||
    lower.includes('voucher')
  ) {
    return withSourceLabel(supabase, await couponsAssistant(supabase, effectiveMessage, intent, region));
  }

  // Buy-now-or-wait intent (Section 19, Phase 0, §12 #52): "should
  // I buy now or wait?" must reach the buy-vs-wait verdict engine,
  // not the deals route ("discount" below) or the generic product
  // search at the bottom. Checked before compare/deals so a
  // question that IS a verdict question is answered as one.
  const buyWaitPatterns = [
    'buy now or wait',
    'buy or wait',
    'should i buy',
    'should i wait',
    'good time to buy',
    'is now a good time',
    'wait to buy',
    'wait for a price drop',
    'will the price drop',
    'will it drop',
    'buy now or hold',
  ];
  if (buyWaitPatterns.some((p) => lower.includes(p))) {
    return withSourceLabel(supabase, await buyWaitAssistant(supabase, effectiveMessage, region));
  }

  // Pros / cons intent (Section 19, Phase 5, §12 #54): "what are
  // the pros and cons of MacBook?" must reach prosConsAssistant,
  // not the generic product search. Checked before compare so a
  // "pros and cons of X vs Y" question is answered as pros/cons
  // for the first named product, not as a comparison.
  const prosConsPatterns = [
    'pros and cons',
    'pros & cons',
    'pros cons',
    'advantages and disadvantages',
    'strengths and weaknesses',
    'good and bad',
    'positives and negatives',
  ];
  if (prosConsPatterns.some((p) => lower.includes(p))) {
    return withSourceLabel(supabase, await prosConsAssistant(supabase, effectiveMessage, region));
  }

  // Competitiveness intent (Section 19, Phase 5, §12 #53): "is
  // this price competitive?" must reach competitivenessAssistant,
  // not the deals route ("deal" below) or the generic product
  // search. Checked before compare/deals so a verdict question is
  // answered as one.
  const competitivenessPatterns = [
    'competitive',
    'is the price good',
    'is it a good price',
    'good price',
    'fair price',
    'overpriced',
    'worth the price',
    'worth it',
  ];
  if (competitivenessPatterns.some((p) => lower.includes(p))) {
    return withSourceLabel(supabase, await competitivenessAssistant(supabase, effectiveMessage, region));
  }

  if (lower.includes('compare') || lower.includes('vs') || lower.includes('versus')) {
    return withSourceLabel(supabase, await compareAssistant(supabase, effectiveMessage, intent, region));
  }

  if (lower.includes('deal') || lower.includes('discount') || lower.includes('sale')) {
    return withSourceLabel(supabase, await dealsAssistant(supabase, region));
  }

  // Budget and general product search share one handler: the old
  // budget intent only delegated to the product-search handler
  // anyway, and both need the same priced-only + hard-budget
  // filtering. The search terms still strip the whole budget
  // expression so "K PKR" never leaks into product matching.
  const searchTerms = stripBudgetFromQuery(effectiveMessage)
    .replace(/best\s+/gi, '')
    .replace(/top\s+/gi, '')
    .trim();
  return withSourceLabel(
    supabase,
    await recommendAssistant(supabase, intent, searchTerms, region)
  );
}

