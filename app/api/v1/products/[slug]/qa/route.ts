/**
 * API v1 product Q&A endpoint (Section 3 #12).
 * GET   /api/v1/products/[slug]/qa — public Q&A for a product.
 * POST  /api/v1/products/[slug]/qa — ask a question (auth required).
 * PATCH /api/v1/products/[slug]/qa — admin answer / hide a question.
 *
 * Answers come from the SmartBuy team (admin) — never auto-generated.
 * With no questions the response is an honest empty list, never
 * seeded Q&A. When migration 028 has not been run yet the table is
 * missing and GET returns an empty list with `qaEnabled: false`
 * instead of an error.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { recordAdminAction } from '@/services/admin';
import {
  apiSuccess,
  badRequest,
  conflict,
  internalError,
  notFound,
  serviceUnavailable,
} from '@/lib/api/responses';
import {
  logApiRequest,
  requireAuth,
  requireAdmin,
  rateLimitResponse,
  getClientIp,
} from '@/lib/api/middleware';
import { getCachedProductBySlug } from '@/services/products';
import {
  getProductQuestions,
  askQuestion,
  answerQuestion,
  validateQuestion,
  validateAnswer,
} from '@/lib/product-qa';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  logApiRequest(request, { endpoint: 'products.qa', slug: params.slug });

  const limited = await rateLimitResponse(`products-qa:${getClientIp(request)}`, 60);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const product = await getCachedProductBySlug(supabase, params.slug);

    if (!product) {
      return notFound('Product not found');
    }

    const questions = await getProductQuestions(supabase, product.id);

    return apiSuccess({
      productId: product.id,
      slug: product.slug,
      questions,
      qaEnabled: true,
    });
  } catch (err) {
    logApiError(err, { request, route: 'products.qa.get', status: 500 });
    return internalError('Failed to fetch questions');
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  logApiRequest(request, { endpoint: 'products.qa.ask', slug: params.slug });

  const limited = await rateLimitResponse(`products-qa-ask:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json().catch(() => null);
    const validationError = validateQuestion(body?.question);
    if (validationError) {
      return badRequest(validationError);
    }

    const supabase = await createSupabaseServerClient();
    const product = await getCachedProductBySlug(supabase, params.slug);

    if (!product) {
      return notFound('Product not found');
    }

    const { question, duplicate } = await askQuestion(
      supabase,
      auth.userId,
      product.id,
      (body.question as string).replace(/\s+/g, ' ').trim()
    );

    if (duplicate) {
      return conflict('You have already asked this exact question for this product.');
    }
    if (!question) {
      // Most likely the product_qa table does not exist yet
      // (migration 028 not run) — say so honestly instead of a
      // generic failure.
      return serviceUnavailable(
        'Questions are not available yet — the Q&A store has not been set up.'
      );
    }

    return apiSuccess(question, 201);
  } catch (err) {
    logApiError(err, { request, route: 'products.qa.post', status: 500 });
    return internalError('Failed to submit your question');
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  logApiRequest(request, { endpoint: 'products.qa.answer', slug: params.slug });

  const limited = await rateLimitResponse(`products-qa-answer:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const admin = await requireAdmin(request);
  if ('error' in admin) return admin.error;

  try {
    const body = await request.json().catch(() => null);
    const questionId = body?.questionId;
    const status = body?.status as string | undefined;
    const answer = body?.answer as unknown;

    if (typeof questionId !== 'string' || questionId.trim() === '') {
      return badRequest('questionId is required');
    }
    if (status !== undefined && status !== 'answered' && status !== 'hidden') {
      return badRequest('status must be "answered" or "hidden"');
    }
    if (answer !== undefined) {
      const answerError = validateAnswer(answer);
      if (answerError) return badRequest(answerError);
    }
    if (answer === undefined && status === undefined) {
      return badRequest('Provide an answer, a status, or both.');
    }

    const supabase = await createSupabaseServerClient();
    const product = await getCachedProductBySlug(supabase, params.slug);
    if (!product) {
      return notFound('Product not found');
    }

    const updated = await answerQuestion(supabase, questionId, admin.userId, {
      answer: typeof answer === 'string' ? answer.trim() : undefined,
      status: status === 'answered' || status === 'hidden' ? status : undefined,
    });

    if (!updated) {
      return internalError('Failed to update the question');
    }

    // Section 20, §12 #97 — audit the admin answer/hide (the
    // route previously wrote with no audit row). Best-effort: the
    // helper never throws, and when no service client is
    // configured the audit is skipped rather than failing the
    // answer the admin just gave.
    const auditService = createSupabaseServiceClient();
    if (auditService) {
      await recordAdminAction(
        auditService,
        admin.userId,
        'product_qa_answer',
        'product_qa',
        questionId,
        {
          slug: params.slug,
          status: status ?? null,
          answered: typeof answer === 'string',
        },
        getClientIp(request)
      );
    }

    return apiSuccess(updated);
  } catch (err) {
    logApiError(err, { request, route: 'products.qa.patch', status: 500 });
    return internalError('Failed to update the question');
  }
}
