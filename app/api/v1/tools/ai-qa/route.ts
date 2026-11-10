/**
 * API v1 AI Product Q&A — POST /api/v1/tools/ai-qa.
 *
 * Deterministic AI answers from RECORDED specs + reviews only
 * (lib/ai-product-qa.ts). No LLM, no key, nothing stored.
 *
 * This is SEPARATE from the human Q&A API
 * (app/api/v1/products/[slug]/qa/route.ts): human answers come from
 * admin and are never auto-generated. Every answer here is labeled
 * "AI answer" with its source and must never be presented as an
 * admin answer. Questions are answered in-memory and never written
 * to the product_qa table.
 *
 * Rate limit: 20 requests/min per IP via rateLimitResponse
 * (lib/api/middleware.ts — Redis sliding window, in-memory fallback).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  badRequest,
  notFound,
  internalError,
} from '@/lib/api/responses';
import {
  logApiRequest,
  getClientIp,
  rateLimitResponse,
} from '@/lib/api/middleware';
import { getCachedProductBySlug } from '@/services/products';
import {
  answerAiQuestion,
  fetchAiQaContext,
} from '@/lib/ai-product-qa';

const AI_QA_LIMIT = 20;

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'tools.ai-qa' });

  const limited = await rateLimitResponse(
    `tools-ai-qa:${getClientIp(request)}`,
    AI_QA_LIMIT
  );
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => null);
    const slug = typeof body?.slug === 'string' ? body.slug.trim() : '';
    const question = typeof body?.question === 'string' ? body.question.trim() : '';

    if (!slug) return badRequest('slug is required');
    if (question.length < 3) {
      return badRequest('Please ask a question of at least 3 characters.');
    }
    if (question.length > 1000) {
      return badRequest('Please keep your question under 1000 characters.');
    }

    const supabase = await createSupabaseServerClient();
    const product = await getCachedProductBySlug(supabase, slug);
    if (!product) return notFound('Product not found');

    const context = await fetchAiQaContext(supabase, product.id);
    const answer = answerAiQuestion(question, context.specs, context.reviews);

    return apiSuccess({
      product: { slug: product.slug, name: product.name },
      question,
      ...answer,
      disclaimer:
        'This is an AI answer generated from recorded specs and reviews — not an answer from the SmartBuy team. For an official answer, ask via the product page Q&A.',
    });
  } catch {
    return internalError('Failed to answer the question');
  }
}
