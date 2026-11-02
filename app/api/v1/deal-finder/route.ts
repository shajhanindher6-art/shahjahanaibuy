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
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';
import { resolveRegion } from '@/lib/region';
import { generateChatResponse } from '@/services/chat';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'deal-finder' });

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

    return apiSuccess({ response: content, metadata });
  } catch {
    return internalError('Failed to generate deal recommendation');
  }
}
