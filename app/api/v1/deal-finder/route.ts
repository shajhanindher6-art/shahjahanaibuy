/**
 * Public AI Deal Finder endpoint.
 * POST /api/v1/deal-finder — no login required, stateless.
 *
 * Unlike /api/v1/chat/messages (dashboard-only, auth required, and
 * tied to a saved conversation), this route answers one message at
 * a time for any visitor and returns product recommendations in
 * metadata.products, which the chat UIs render as clickable
 * product cards.
 *
 * It reuses services/chat.ts generateChatResponse — the same
 * template-based engine as the dashboard chat (budget / category /
 * deal / compare intents over the products and deals tables, no
 * external AI API, no review text sent anywhere). Because it runs
 * with the anon server client, it can only see rows the public
 * RLS policies already expose (products, deals, price_history).
 *
 * Transport (Vercel AI SDK v4 data-stream protocol):
 * - Request shape { message, country } (legacy callers) with
 *   Accept: application/json (or anything else) → the exact JSON
 *   response as before: { success, data: { response, metadata } }.
 * - Request shape { messages, country } (the SDK's `useChat`
 *   hook, which posts the full history and never sends
 *   `Accept: text/event-stream`) → the AI SDK data stream:
 *   `0:` text parts carrying the answer's own lines, one `2:`
 *   data part carrying { products } for the product chips, then a
 *   `d:` finish_message part. Legacy { message } callers that
 *   send `Accept: text/event-stream` get the same data stream.
 *
 * HONEST TRANSPORT NOTE: the deterministic engine produces the
 * whole answer atomically — there is no token-by-token LLM.
 * The text parts are the answer's own lines, written immediately
 * after it is computed (no added delays, no fake typing
 * animation). Rejoining them reproduces the JSON answer byte for
 * byte: this is transport streaming (progressive rendering) via
 * the AI SDK's standardized hooks, not token generation.
 * Errors (bad input, rate limit, generation failure) still
 * return the same JSON error as the non-streaming path —
 * nothing is streamed before the answer exists.
 */

import type { NextRequest } from 'next/server';
import { createDataStreamResponse, formatDataStreamPart } from 'ai';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { resolveRegion } from '@/lib/region';
import { generateChatResponse, type ChatMetadata } from '@/services/chat';

/**
 * Split the computed answer into stream chunks — one per line.
 * The assistant's content is line-built (best-pick line, price
 * line, per-product bullet lines), so lines are the natural
 * genuine units. Empty lines keep their newline as their own
 * chunk, so chunks.join('') === content exactly.
 */
function splitIntoChunks(content: string): string[] {
  if (content === '') return [];
  const lines = content.split('\n');
  return lines
    .map((line, i) => (i < lines.length - 1 ? `${line}\n` : line))
    .filter((chunk) => chunk !== '');
}

/**
 * AI SDK data-stream response: text-delta parts for the answer's
 * own lines, one data part with the product recommendations, then
 * the finish part the `useChat` client waits for before calling
 * its onFinish handler.
 */
function dataStreamResponse(content: string, metadata: ChatMetadata | null): Response {
  return createDataStreamResponse({
    headers: {
      'Cache-Control': 'no-cache, no-transform',
      // Proxies/CDNs must not buffer the stream into one blob.
      'X-Accel-Buffering': 'no',
    },
    execute(dataStream) {
      for (const chunk of splitIntoChunks(content)) {
        dataStream.write(formatDataStreamPart('text', chunk));
      }
      // One data part per turn: the client collects these into its
      // `data` state, one entry per assistant turn, and renders the
      // products as chips under that turn's answer.
      dataStream.writeData({ products: metadata?.products ?? [] });
      dataStream.write(formatDataStreamPart('finish_message', { finishReason: 'stop' }));
    },
  });
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'deal-finder' });

  // AI compute is unauthenticated by design; cap it per IP so one
  // client cannot flood the assistant. In-memory bucket (per
  // instance) — see lib/api/middleware.ts; Redis is the Phase 2 step.
  const limited = await rateLimitResponse(`deal-finder:${getClientIp(request)}`, 20);
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => null);

    // Two request shapes, one engine:
    // - Legacy: { message: string, country?: string }.
    // - Vercel AI SDK `useChat`: { messages: [{ role, content }...],
    //   country?: string } — the hook posts the full history plus
    //   the `body` option merged in. The engine is stateless, so
    //   the last user message is the query.
    let message: unknown;
    let useChatShape = false;
    if (Array.isArray(body?.messages)) {
      useChatShape = true;
      const lastUser = [...body.messages]
        .reverse()
        .find(
          (m): m is { role: string; content: unknown } =>
            !!m && typeof m === 'object' && (m as { role?: unknown }).role === 'user'
        );
      message = lastUser?.content;
    } else {
      message = body?.message;
    }

    if (typeof message !== 'string' || message.trim() === '') {
      return badRequest('message is required');
    }
    if (message.length > 500) {
      return badRequest('message must be 500 characters or fewer');
    }

    // Visitor region from the widget's RegionProvider (cookie /
    // IP detection). Unknown or missing codes fall back to US via
    // resolveRegion, so prices stay plain "$999.00" — never a
    // crash, never a guessed region.
    const region = resolveRegion(typeof body?.country === 'string' ? body.country : null);

    const supabase = await createSupabaseServerClient();
    const { content, metadata } = await generateChatResponse(supabase, message.trim(), [], { region });

    // Streaming: the AI SDK data-stream protocol. `useChat` never
    // sends `Accept: text/event-stream` (it posts plain JSON), so
    // the useChat shape streams on body shape alone; the legacy
    // shape streams only on an explicit SSE Accept header.
    const accept = request.headers.get('accept') ?? '';
    if (useChatShape || accept.includes('text/event-stream')) {
      return dataStreamResponse(content, metadata);
    }

    return apiSuccess({ response: content, metadata });
  } catch {
    return internalError('Failed to generate deal recommendation');
  }
}
