/**
 * Public AI Deal Finder endpoint.
 * POST /api/v1/deal-finder — no login required, stateless.
 *
 * Unlike /api/v1/chat/messages (dashboard-only, auth required, and
 * tied to a saved conversation), this route answers one message at
 * a time for any visitor and returns product recommendations in
 * metadata.products, which the floating Deal Finder widget renders
 * as clickable product cards.
 *
 * It reuses services/chat.ts generateChatResponse — the same
 * template-based engine as the dashboard chat (budget / category /
 * deal / compare intents over the products and deals tables, no
 * external AI API, no review text sent anywhere). Because it runs
 * with the anon server client, it can only see rows the public
 * RLS policies already expose (products, deals, price_history).
 *
 * Transport: two shapes, same answer, same rate limit.
 * - Accept: application/json (or anything else) → the exact JSON
 *   response as before: { success, data: { response, metadata } }.
 * - Accept: text/event-stream → Server-Sent Events. The
 *   deterministic engine produces the whole answer atomically
 *   (there is no token-by-token LLM), so the stream emits the
 *   answer's own lines as `data: {"type":"chunk","text":...}`
 *   events immediately after it is computed — no added delays,
 *   no fake typing animation — followed by a final
 *   `data: {"type":"done","metadata":...}` event carrying the
 *   product recommendations. Rejoining the chunk texts
 *   reproduces the JSON answer byte for byte: this is transport
 *   streaming (progressive rendering), not token generation.
 *   Errors (bad input, rate limit, generation failure) still
 *   return the same JSON error as the non-streaming path —
 *   nothing is streamed before the answer exists.
 */

import type { NextRequest } from 'next/server';
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

function streamResponse(content: string, metadata: ChatMetadata | null): Response {
  const encoder = new TextEncoder();
  const chunks = splitIntoChunks(content);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const text of chunks) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`)
        );
      }
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: 'done', metadata })}\n\n`)
      );
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Proxies/CDNs must not buffer the stream into one blob.
      'X-Accel-Buffering': 'no',
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
    const message = body?.message;

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

    // Content negotiation: only an explicit SSE Accept streams.
    // Every other caller (including plain fetch with the default
    // Accept: */*) gets the exact JSON response as before.
    const accept = request.headers.get('accept') ?? '';
    if (accept.includes('text/event-stream')) {
      return streamResponse(content, metadata);
    }

    return apiSuccess({ response: content, metadata });
  } catch {
    return internalError('Failed to generate deal recommendation');
  }
}
