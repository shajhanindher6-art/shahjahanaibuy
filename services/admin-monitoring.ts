/**
 * Admin monitoring surfaces — Sections 21–25, Stage G (audit §4:
 * "Alert delivery monitoring MISSING" + "Background job
 * monitoring MISSING"; §13 step 7).
 *
 * READ-ONLY admin views over records that already exist — no new
 * tables, no new migration, nothing inserted:
 *
 * - Alert delivery: `notification_queue` (signed-in users —
 *   status pending/sent/failed, retry_count, last_error),
 *   `guest_notification_queue` (guest email alerts, migration
 *   026), and `digest_failures` (migration 050). Every read is
 *   missing-table honest: an unapplied migration returns
 *   `tableMissing: true` + an error string, never an empty list
 *   pretending nothing was ever queued.
 * - Background jobs: the in-memory queue state from
 *   `lib/workers/queue.ts` — metrics, the dead-letter queue
 *   (max 1,000, this instance only), and the last-100 recorded
 *   job outcomes. Per-instance state by design: a job that ran
 *   on another Vercel instance does not appear here, and a
 *   BullMQ job never records an outcome on this instance — the
 *   surface says so in its note instead of inventing one.
 *
 * All DB reads take the G-P1-4 defense-in-depth re-check
 * (`adminUserId` → `assertAdminServiceAccess`); see
 * lib/admin-role.ts. The in-memory job status takes no user id —
 * it reads module state, not the database, and its only callers
 * are the admin-only monitoring route and page (both guarded).
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { assertAdminServiceAccess } from '@/lib/admin-role';
import {
  getDeadLetterQueue,
  getQueue,
  getQueueMetrics,
  listJobResults,
} from '@/lib/workers/queue';
import type { JobResult } from '@/lib/workers/queue';

export interface AdminServiceOptions {
  adminUserId?: string;
}

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205';
}

// ---------------------------------------------------------------------------
// Alert delivery — notification_queue
// ---------------------------------------------------------------------------

export interface AlertDeliveryRow {
  id: string;
  userId: string | null;
  type: string;
  channel: string;
  subject: string | null;
  status: string;
  retryCount: number | null;
  lastError: string | null;
  scheduledFor: string | null;
  sentAt: string | null;
  createdAt: string | null;
}

export interface ListAlertDeliveriesResult {
  deliveries: AlertDeliveryRow[];
  counts: { pending: number; sent: number; failed: number; total: number };
  error: string | null;
  tableMissing: boolean;
}

export const ALERT_DELIVERY_STATUSES = ['pending', 'sent', 'failed'] as const;

export async function listAlertDeliveries(
  supabase: AnySupabaseClient,
  opts: AdminServiceOptions & {
    limit?: number;
    status?: string;
    channel?: string;
  } = {}
): Promise<ListAlertDeliveriesResult> {
  if (opts.adminUserId !== undefined) {
    await assertAdminServiceAccess(supabase, opts.adminUserId);
  }
  const empty: ListAlertDeliveriesResult = {
    deliveries: [],
    counts: { pending: 0, sent: 0, failed: 0, total: 0 },
    error: null,
    tableMissing: false,
  };
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  try {
    let query = supabase
      .from('notification_queue')
      .select('id, user_id, type, channel, subject, status, retry_count, last_error, scheduled_for, sent_at, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (opts.status && (ALERT_DELIVERY_STATUSES as readonly string[]).includes(opts.status)) {
      query = query.eq('status', opts.status);
    }
    if (opts.channel) {
      query = query.eq('channel', opts.channel);
    }
    const { data, error } = await query;
    if (error || !data) {
      if (error) logger.warn('listAlertDeliveries: query failed', { error: error.message });
      if (error && isMissingTableError(error)) {
        return {
          ...empty,
          error: 'Notification queue table is not available yet — migration 009 has not been applied.',
          tableMissing: true,
        };
      }
      return { ...empty, error: error?.message ?? 'Alert deliveries could not be read.' };
    }

    // Status counts are separate head queries so the filtered page
    // never masquerades as the totals.
    const counts: ListAlertDeliveriesResult['counts'] = { pending: 0, sent: 0, failed: 0, total: 0 };
    for (const status of ALERT_DELIVERY_STATUSES) {
      const { count, error: countError } = await supabase
        .from('notification_queue')
        .select('id', { count: 'exact', head: true })
        .eq('status', status);
      if (!countError && typeof count === 'number') {
        counts[status] = count;
        counts.total += count;
      }
    }

    return {
      deliveries: (data as Array<Record<string, unknown>>).map((row) => ({
        id: row.id as string,
        userId: (row.user_id as string | null) ?? null,
        type: row.type as string,
        channel: row.channel as string,
        subject: (row.subject as string | null) ?? null,
        status: row.status as string,
        retryCount: typeof row.retry_count === 'number' ? row.retry_count : null,
        lastError: (row.last_error as string | null) ?? null,
        scheduledFor: (row.scheduled_for as string | null) ?? null,
        sentAt: (row.sent_at as string | null) ?? null,
        createdAt: (row.created_at as string | null) ?? null,
      })),
      counts,
      error: null,
      tableMissing: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('listAlertDeliveries: unexpected error', { error: message });
    return { ...empty, error: message };
  }
}

// ---------------------------------------------------------------------------
// Alert delivery — guest_notification_queue (migration 026)
// ---------------------------------------------------------------------------

export interface GuestAlertDeliveryRow {
  id: string;
  guestAlertId: string;
  email: string;
  subject: string;
  productId: string | null;
  status: string;
  errorMessage: string | null;
  sentAt: string | null;
  createdAt: string | null;
}

export interface ListGuestAlertDeliveriesResult {
  deliveries: GuestAlertDeliveryRow[];
  counts: { pending: number; sent: number; failed: number; total: number };
  error: string | null;
  tableMissing: boolean;
}

export async function listGuestAlertDeliveries(
  supabase: AnySupabaseClient,
  opts: AdminServiceOptions & { limit?: number; status?: string } = {}
): Promise<ListGuestAlertDeliveriesResult> {
  if (opts.adminUserId !== undefined) {
    await assertAdminServiceAccess(supabase, opts.adminUserId);
  }
  const empty: ListGuestAlertDeliveriesResult = {
    deliveries: [],
    counts: { pending: 0, sent: 0, failed: 0, total: 0 },
    error: null,
    tableMissing: false,
  };
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  try {
    let query = supabase
      .from('guest_notification_queue')
      .select('id, guest_alert_id, email, subject, product_id, status, error_message, sent_at, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (opts.status && (ALERT_DELIVERY_STATUSES as readonly string[]).includes(opts.status)) {
      query = query.eq('status', opts.status);
    }
    const { data, error } = await query;
    if (error || !data) {
      if (error) logger.warn('listGuestAlertDeliveries: query failed', { error: error.message });
      if (error && isMissingTableError(error)) {
        return {
          ...empty,
          error: 'Guest notification queue table is not available yet — migration 026 has not been applied.',
          tableMissing: true,
        };
      }
      return { ...empty, error: error?.message ?? 'Guest alert deliveries could not be read.' };
    }
    const counts: ListGuestAlertDeliveriesResult['counts'] = { pending: 0, sent: 0, failed: 0, total: 0 };
    for (const status of ALERT_DELIVERY_STATUSES) {
      const { count, error: countError } = await supabase
        .from('guest_notification_queue')
        .select('id', { count: 'exact', head: true })
        .eq('status', status);
      if (!countError && typeof count === 'number') {
        counts[status] = count;
        counts.total += count;
      }
    }
    return {
      deliveries: (data as Array<Record<string, unknown>>).map((row) => ({
        id: row.id as string,
        guestAlertId: row.guest_alert_id as string,
        email: row.email as string,
        subject: row.subject as string,
        productId: (row.product_id as string | null) ?? null,
        status: row.status as string,
        errorMessage: (row.error_message as string | null) ?? null,
        sentAt: (row.sent_at as string | null) ?? null,
        createdAt: (row.created_at as string | null) ?? null,
      })),
      counts,
      error: null,
      tableMissing: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('listGuestAlertDeliveries: unexpected error', { error: message });
    return { ...empty, error: message };
  }
}

// ---------------------------------------------------------------------------
// Alert delivery — digest_failures (migration 050)
// ---------------------------------------------------------------------------

export interface DigestFailureRow {
  id: string;
  userId: string;
  reason: string;
  createdAt: string | null;
}

export interface ListDigestFailuresResult {
  failures: DigestFailureRow[];
  error: string | null;
  tableMissing: boolean;
}

export async function listDigestFailures(
  supabase: AnySupabaseClient,
  opts: AdminServiceOptions & { limit?: number } = {}
): Promise<ListDigestFailuresResult> {
  if (opts.adminUserId !== undefined) {
    await assertAdminServiceAccess(supabase, opts.adminUserId);
  }
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  try {
    const { data, error } = await supabase
      .from('digest_failures')
      .select('id, user_id, reason, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) {
      if (error) logger.warn('listDigestFailures: query failed', { error: error.message });
      if (error && isMissingTableError(error)) {
        return {
          failures: [],
          error: 'Digest failures table is not available yet — migration 050 has not been applied.',
          tableMissing: true,
        };
      }
      return {
        failures: [],
        error: error?.message ?? 'Digest failures could not be read.',
        tableMissing: false,
      };
    }
    return {
      failures: (data as Array<Record<string, unknown>>).map((row) => ({
        id: row.id as string,
        userId: row.user_id as string,
        reason: row.reason as string,
        createdAt: (row.created_at as string | null) ?? null,
      })),
      error: null,
      tableMissing: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('listDigestFailures: unexpected error', { error: message });
    return { failures: [], error: message, tableMissing: false };
  }
}

// ---------------------------------------------------------------------------
// Background jobs — in-memory queue state (this instance only)
// ---------------------------------------------------------------------------

export interface BackgroundJobStatus {
  /** 'synchronous' when the in-process queue runs (the live state — BullMQ is not installed); 'bullmq' only if the BullMQ adapter ever loads, which needs the package installed AND Redis provisioned (unreachable today). */
  mode: 'synchronous' | 'bullmq';
  usingRedis: boolean;
  metrics: {
    completed: number;
    failed: number;
    enqueued: number;
    throughputPerMin: number;
    deadLetterCount: number;
  };
  deadLetter: ReturnType<typeof getDeadLetterQueue>;
  recentJobs: Array<{ jobId: string; result: JobResult }>;
  /** Honesty note rendered verbatim on the page. */
  note: string;
}

export function getBackgroundJobStatus(): BackgroundJobStatus {
  const usingRedis = getQueue().isUsingRedis();
  return {
    mode: usingRedis ? 'bullmq' : 'synchronous',
    usingRedis,
    metrics: getQueueMetrics(),
    deadLetter: getDeadLetterQueue(),
    recentJobs: listJobResults(),
    note: usingRedis
      ? 'BullMQ mode: jobs run asynchronously elsewhere, so no job outcome is recorded on this instance — the recent-jobs list below only ever holds synchronously-run jobs.'
      : 'Synchronous in-process queue (no Redis configured): jobs run inline on this instance only. Counts, dead-letter entries and recent outcomes below are this instance\u2019s state — other Vercel instances are not shown, and everything is lost on redeploy/restart.',
  };
}
