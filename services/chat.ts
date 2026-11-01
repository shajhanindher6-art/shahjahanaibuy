/**
 * AI Shopping Chat Assistant service.
 * Handles conversation management and AI-powered responses.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { parseSearchIntent } from './ai-search';
import { stripBudgetFromQuery, formatOriginalAmount } from './currency';

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

export async function generateChatResponse(
  supabase: AnySupabaseClient,
  userMessage: string,
  conversationHistory: ChatMessage[]
): Promise<{ content: string; metadata: ChatMetadata | null }> {
  const intent = parseSearchIntent(userMessage);
  const lower = userMessage.toLowerCase();

  if (lower.includes('compare') || lower.includes('vs') || lower.includes('versus')) {
    return handleComparisonIntent(supabase, userMessage, intent);
  }

  if (lower.includes('budget') || lower.includes('under $') || lower.includes('affordable') || intent.budget) {
    return handleBudgetIntent(supabase, userMessage, intent);
  }

  if (lower.includes('deal') || lower.includes('discount') || lower.includes('sale')) {
    return handleDealIntent(supabase);
  }

  return handleProductSearchIntent(supabase, userMessage, intent);
}

async function handleProductSearchIntent(
  supabase: AnySupabaseClient,
  message: string,
  intent: ReturnType<typeof parseSearchIntent>
): Promise<{ content: string; metadata: ChatMetadata | null }> {
  const searchTerms = stripBudgetFromQuery(message)
    .replace(/best\s+/gi, '')
    .replace(/top\s+/gi, '')
    .trim();

  let query = supabase
    .from('products')
    .select('id, name, slug, brand, category, image_url, confidence_score')
    .is('deleted_at', null);

  if (searchTerms) {
    query = query.or(`name.ilike.%${searchTerms}%,description.ilike.%${searchTerms}%,brand.ilike.%${searchTerms}%`);
  }
  if (intent.category) {
    query = query.ilike('category', `%${intent.category}%`);
  }

  const { data, error } = await query
    .order('confidence_score', { ascending: false })
    .limit(4);

  if (error || !data || data.length === 0) {
    return {
      content: `I couldn't find products matching "${message}". Could you try rephrasing your search? For example, "best laptop under $1000" or "noise cancelling headphones".`,
      metadata: null,
    };
  }

  const products = (data as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    brand: row.brand as string | null,
    imageUrl: row.image_url as string | null,
    price: null as number | null,
  }));

  let priceMetadata = products;
  if (intent.budget) {
    for (const p of priceMetadata) {
      const { data: priceData } = await supabase
        .from('price_history')
        .select('price')
        .eq('product_id', p.id)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      p.price = priceData ? parseFloat(String((priceData as Record<string, unknown>).price)) : null;
    }
    priceMetadata = priceMetadata.filter((p) => p.price === null || p.price <= intent.budget!);
  }

  const productList = priceMetadata
    .map((p, i) => `${i + 1}. ${p.name}${p.brand ? ` (${p.brand})` : ''}${p.price ? ` — $${p.price.toFixed(2)}` : ''}`)
    .join('\n');

  // The list keeps items with no recorded price (price === null),
  // so "all of these are within your budget" would over-claim for
  // them. Only claim it outright when every shown item has a
  // verified price (the filter above already dropped the
  // over-budget ones); otherwise say so honestly.
  const budgetLabel =
    intent.budgetCurrency && intent.budgetCurrency !== 'USD' && intent.budgetOriginal !== null
      ? `${formatOriginalAmount(intent.budgetOriginal)} ${intent.budgetCurrency} (≈ $${intent.budget} USD)`
      : `$${intent.budget}`;
  const allPriced = priceMetadata.every((p) => p.price !== null);
  const budgetNote = intent.budget
    ? allPriced
      ? ` All of these are within your ${budgetLabel} budget.`
      : ` Items shown with a recorded price are within your ${budgetLabel} budget; items without a recorded price are listed for comparison.`
    : '';

  return {
    content: `Here are some great options I found for you:\n\n${productList}\n\nWould you like me to compare any of these, or would you like more details about a specific product?${budgetNote}`,
    metadata: { products: priceMetadata, intent: intent.intent, budget: intent.budget ?? undefined },
  };
}

async function handleBudgetIntent(
  supabase: AnySupabaseClient,
  message: string,
  intent: ReturnType<typeof parseSearchIntent>
): Promise<{ content: string; metadata: ChatMetadata | null }> {
  if (!intent.budget) {
    return {
      content: "I'd be happy to help you find products within your budget! What's your budget range? For example, you can say 'best laptop under $1000'.",
      metadata: null,
    };
  }

  return handleProductSearchIntent(supabase, message, intent);
}

async function handleComparisonIntent(
  supabase: AnySupabaseClient,
  message: string,
  intent: ReturnType<typeof parseSearchIntent>
): Promise<{ content: string; metadata: ChatMetadata | null }> {
  const searchTerms = message
    .replace(/compare\s+/gi, '')
    .replace(/vs\.?/gi, '')
    .replace(/versus\s+/gi, '')
    .trim();

  const { data } = await supabase
    .from('products')
    .select('id, name, slug, brand, category, image_url')
    .is('deleted_at', null)
    .or(`name.ilike.%${searchTerms}%,brand.ilike.%${searchTerms}%`)
    .limit(2);

  if (!data || data.length < 2) {
    return {
      content: `I'd love to help you compare products! Please tell me which products you'd like to compare. For example, 'compare iPhone vs Samsung Galaxy' or use the Compare page for a detailed side-by-side comparison.`,
      metadata: null,
    };
  }

  const products = (data as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    brand: row.brand as string | null,
    imageUrl: row.image_url as string | null,
    price: null as number | null,
  }));

  return {
    content: `I found some products to compare:\n\n${products.map((p, i) => `${i + 1}. ${p.name}${p.brand ? ` (${p.brand})` : ''}`).join('\n')}\n\nFor a detailed comparison with prices, ratings, and AI analysis, visit the Compare page. Would you like more details about either product?`,
    metadata: { products, comparison: `${products[0]?.name} vs ${products[1]?.name}` },
  };
}

async function handleDealIntent(
  supabase: AnySupabaseClient
): Promise<{ content: string; metadata: ChatMetadata | null }> {
  const { data } = await supabase
    .from('deals')
    .select('id, title, deal_type, discount_type, discount_value, end_at, coupon_code')
    .eq('active', true)
    .is('deleted_at', null)
    .gte('end_at', new Date().toISOString())
    .order('discount_value', { ascending: false })
    .limit(4);

  if (!data || data.length === 0) {
    return {
      content: "I don't see any active deals right now. Check the Deals page for the latest offers, or set up a price alert to be notified when prices drop!",
      metadata: null,
    };
  }

  const deals = (data as Array<Record<string, unknown>>).map((d) => ({
    title: d.title as string,
    discount: `${d.discount_value}${d.discount_type === 'percentage' ? '%' : '$'}`,
    coupon: d.coupon_code as string | null,
    endsAt: d.end_at as string,
  }));

  const dealList = deals
    .map((d, i) => `${i + 1}. ${d.title} — ${d.discount} off${d.coupon ? ` (Code: ${d.coupon})` : ''}`)
    .join('\n');

  return {
    content: `Here are today's best deals:\n\n${dealList}\n\nVisit the Deals page for more offers and AI-ranked discounts!`,
    metadata: null,
  };
}
