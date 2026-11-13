/**
 * API v1 admin AI jobs endpoint.
 * POST /api/v1/admin/ai/jobs — enqueue an expensive AI visual
 * analysis as an `ai.analyze` job (Section 19, Phase 8, §12 #12).
 *
 * Body: { imageUrl?: string, caption?: string, limit?: number, preferClip?: boolean }
 * - imageUrl: a PUBLIC image URL. Captioned with BLIP, embedded
 *   and matched against the catalog — the same analysis the live
 *   visual-search route runs inline, but as a job: retried with
 *   backoff on transient HF failures, idempotent, DLQ'd on
 *   exhaustion. Uploaded photos are NEVER accepted here: only a
 *   public URL or plain caption text. Nothing is stored.
 * - caption: plain text to embed and match directly (no
 *   captioning call, no image fetch).
 * - limit: max matches, 1..10, default 5.
 *
 * ADMIN-ONLY (requireAdmin) + rate-limited: each job spends
 * Hugging Face quota, so it must not be an anonymous endpoint.
 *
 * Response honesty (mirrors POST /api/v1/data/refresh, Section
 * 18 item 41): with no Redis configured the job runs
 * synchronously in-process, so the response reports its REAL
 * outcome (200 'completed' / 'failed' with the processed count,
 * errors and the match result, read from getJobResult). The 202
 * 'queued' response is kept ONLY for the paths where the work
 * genuinely has not run yet (a delayed job — or a real async
 * queue, if one is ever provisioned; BullMQ is not installed,
 * so no BullMQ path exists today). No real async queue was introduced.
 *
 * The job result is NOT stored in a table (no migration in this
 * phase): the outcome lives in `JobResult.metadata` (last 100
 * jobs, this instance) and the caption/embedding are left in the
 * visual-search cache, warming the next live request.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { getClientIp, logApiRequest, rateLimitResponse, requireAdmin } from '@/lib/api/middleware';
import { checkCsrfOrigin } from '@/lib/api/csrf';
import { recordAdminAction } from '@/services/admin';
import { logApiError } from '@/lib/api/error-logging';
import { getJobResult } from '@/lib/workers/queue';
import { enqueueAiVisualAnalysis } from '@/services/ai-background-jobs';
import {
  adminAiJobsSchema,
  invalidBodyResponse,
  validateBody,
} from '@/lib/api/validation';

/**
 * Section 19, Phase 8 (§12 #12) — `maxDuration` 60 (Vercel Hobby
 * cap — do NOT raise without a paid plan). The job runs
 * synchronously when Redis is not configured, so the inline
 * caption + embedding + match must finish inside this cap.
 */
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'admin.ai-jobs' });
  const startedAt = Date.now();

  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`admin-ai-jobs:${getClientIp(request)}`, 10);
  if (limited) return limited;

  // Sections 21–25, Stage G, G-P1-3 — CSRF Origin check
  // (cookie-authed mutation; absent Origin fails open for
  // non-browser clients). The middleware layer checks this too.
  const csrf = checkCsrfOrigin(request);
  if (csrf) return csrf;

  try {
    const body = await request.json().catch(() => null);
    // Sections 21–25, Stage G, G-P2-1 — shared Zod gate (was an
    // inline schema here; same rules, now in lib/api/validation).
    // A failed check returns 400 via invalidBodyResponse; the
    // imageUrl/caption required-ness check below is unchanged.
    const validation = validateBody(adminAiJobsSchema, body ?? {});
    if (!validation.success) {
      // invalidBodyResponse is non-null exactly when validation
      // failed; the fallback is unreachable, it only satisfies
      // the type checker (and narrows `validation` below).
      return invalidBodyResponse(validation) ?? badRequest('Invalid request body');
    }
    const parsed = validation;
    if (!parsed.data.imageUrl && !parsed.data.caption) {
      return badRequest('Provide a public image URL (imageUrl) or a text description (caption).');
    }

    const { jobId } = await enqueueAiVisualAnalysis(parsed.data);

    // Sections 21–25, Stage G, G-P1-2 — audit the enqueue: each
    // job spends Hugging Face quota, so who enqueued what is
    // part of the audit trail. recordAdminAction never throws.
    const auditService = createSupabaseServiceClient();
    if (auditService) {
      await recordAdminAction(
        auditService,
        auth.userId,
        'ai_job_enqueue',
        'ai_job',
        jobId,
        {
          hasImageUrl: Boolean(parsed.data.imageUrl),
          hasCaption: Boolean(parsed.data.caption),
          limit: parsed.data.limit ?? 5,
          preferClip: parsed.data.preferClip ?? false,
        },
        getClientIp(request)
      );
    }

    // The job ran inline on the synchronous queue, so report its
    // real outcome instead of "queued". When no result is recorded
    // (a delayed job — there is no BullMQ worker today, the
    // package is not installed) the work has genuinely not run
    // yet, and 202 'queued' stays honest.
    const outcome = getJobResult(jobId);
    if (outcome) {
      return apiSuccess({
        jobId,
        status: outcome.success ? 'completed' : 'failed',
        processed: outcome.processed,
        errors: outcome.errors ?? [],
        result: outcome.metadata ?? null,
      });
    }
    return apiSuccess({ jobId, status: 'queued' }, 202);
  } catch (err) {
    logApiError(err, { request, route: 'admin.ai-jobs', status: 500, startedAt });
    return internalError('Failed to enqueue AI analysis job');
  }
}
