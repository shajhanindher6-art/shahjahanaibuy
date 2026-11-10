/**
 * API v1 consumer subscriptions — Section 7, item 3.
 * GET    /api/v1/tools/consumer-subscriptions — the signed-in user's
 *          consumer subscriptions (Netflix, Spotify, …) plus the
 *          derived monthly total, renewal reminders, overlap groups
 *          and rarely-used flags.
 * POST   — add a subscription.
 * PUT    — update one of the caller's subscriptions (id in body).
 * DELETE — remove one of the caller's subscriptions (?id=).
 *
 * This is NOT the Stripe Premium-plan API at
 * `app/api/v1/subscriptions` — that route is untouched and never
 * reused here. Cheaper alternatives are only ever shown from real
 * recorded data: this API records none, so it suggests none.
 *
 * Fail-safe: until the migration is run, GET returns
 * { subscriptions: [], ..., subscriptionsEnabled: false } and
 * writes return 503.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  internalError,
  notFound,
  serviceUnavailable,
  validationError,
} from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, requireAuth } from '@/lib/api/middleware';
import { isMissingTableError } from '@/lib/agent-hunt';
import {
  findOverlaps,
  isRarelyUsed,
  monthlyCost,
  renewalReminders,
  renewalStatus,
  roundToCents,
  totalMonthlyCost,
  type BillingInterval,
  type ConsumerSubscription,
  type RenewalStatus,
} from '@/lib/subscription-manager';

export const dynamic = 'force-dynamic';

const SUBSCRIPTION_COLUMNS =
  'id, user_id, name, price_usd, billing_interval, renewal_date, category, is_active, last_used_at, created_at';

function isMissingTableOrColumn(error: unknown): boolean {
  if (isMissingTableError(error)) return true;
  const code = (error as { code?: unknown } | null)?.code;
  return code === '42703';
}

function mapSubscriptionRow(row: Record<string, unknown>): ConsumerSubscription | null {
  const price =
    typeof row.price_usd === 'number' ? row.price_usd : parseFloat(String(row.price_usd));
  if (!Number.isFinite(price) || price <= 0) return null;
  if (typeof row.name !== 'string' || row.name.trim() === '') return null;
  const interval: BillingInterval =
    row.billing_interval === 'yearly' ? 'yearly' : 'monthly';
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: row.name.trim(),
    priceUsd: roundToCents(price),
    billingInterval: interval,
    renewalDate:
      typeof row.renewal_date === 'string' && row.renewal_date !== ''
        ? row.renewal_date
        : null,
    category: typeof row.category === 'string' && row.category.trim() !== '' ? row.category.trim() : null,
    isActive: row.is_active !== false,
    lastUsedAt:
      typeof row.last_used_at === 'string' && row.last_used_at !== '' ? row.last_used_at : null,
    createdAt: String(row.created_at),
  };
}

interface EnrichedSubscription extends ConsumerSubscription {
  monthlyUsd: number;
  renewal: RenewalStatus;
}

interface SubscriptionSummary {
  subscriptions: EnrichedSubscription[];
  totalMonthlyUsd: number;
  reminders: ConsumerSubscription[];
  overlaps: Array<{ normalizedName: string; subscriptions: ConsumerSubscription[] }>;
  rarelyUsedIds: string[];
  subscriptionsEnabled: boolean;
}

function buildSummary(subscriptions: ConsumerSubscription[], enabled: boolean): SubscriptionSummary {
  const overlaps = findOverlaps(subscriptions);
  const rarelyUsedIds = subscriptions
    .filter((sub) => sub.isActive && isRarelyUsed(sub))
    .map((sub) => sub.id);
  return {
    subscriptions: subscriptions.map((sub) => ({
      ...sub,
      monthlyUsd: monthlyCost(sub.priceUsd, sub.billingInterval),
      renewal: renewalStatus(sub),
    })),
    totalMonthlyUsd: totalMonthlyCost(subscriptions),
    reminders: renewalReminders(subscriptions),
    overlaps,
    rarelyUsedIds,
    subscriptionsEnabled: enabled,
  };
}

function validIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

function parseCreateBody(body: unknown): {
  values?: {
    name: string;
    priceUsd: number;
    billingInterval: BillingInterval;
    renewalDate: string | null;
    category: string | null;
    lastUsedAt: string | null;
    isActive: boolean;
  };
  error?: ReturnType<typeof validationError>;
} {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) return { error: validationError('name is required.') };
  const priceUsd = b.price_usd;
  if (typeof priceUsd !== 'number' || !Number.isFinite(priceUsd) || priceUsd <= 0) {
    return { error: validationError('price_usd must be a number greater than 0.') };
  }
  if (b.billing_interval !== 'monthly' && b.billing_interval !== 'yearly') {
    return { error: validationError("billing_interval must be 'monthly' or 'yearly'.") };
  }
  const renewalDate = b.renewal_date === null || b.renewal_date === undefined ? null : b.renewal_date;
  if (renewalDate !== null && !validIsoDate(renewalDate)) {
    return { error: validationError('renewal_date must be a valid date (YYYY-MM-DD) or null.') };
  }
  const lastUsedAt = b.last_used_at === null || b.last_used_at === undefined ? null : b.last_used_at;
  if (lastUsedAt !== null && !validIsoDate(lastUsedAt)) {
    return { error: validationError('last_used_at must be a valid date (YYYY-MM-DD) or null.') };
  }
  return {
    values: {
      name,
      priceUsd: roundToCents(priceUsd),
      billingInterval: b.billing_interval,
      renewalDate,
      category:
        typeof b.category === 'string' && b.category.trim() !== '' ? b.category.trim() : null,
      lastUsedAt,
      isActive: b.is_active !== false,
    },
  };
}

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'tools.consumer-subscriptions' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`tools-consumer-subs:${auth.userId}`, 30);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('consumer_subscriptions')
      .select(SUBSCRIPTION_COLUMNS)
      .eq('user_id', auth.userId)
      .order('name', { ascending: true });
    if (error) {
      if (isMissingTableOrColumn(error)) {
        return apiSuccess(buildSummary([], false));
      }
      return internalError('Failed to fetch subscriptions');
    }
    const subscriptions = ((data ?? []) as Array<Record<string, unknown>>)
      .map(mapSubscriptionRow)
      .filter((row): row is ConsumerSubscription => row !== null);
    return apiSuccess(buildSummary(subscriptions, true));
  } catch {
    return internalError('Failed to fetch subscriptions');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'tools.consumer-subscriptions.create' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`tools-consumer-subs:${auth.userId}`, 30);
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => null);
    const parsed = parseCreateBody(body);
    if (parsed.error) return parsed.error;
    const values = parsed.values!;

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('consumer_subscriptions')
      .insert({
        user_id: auth.userId,
        name: values.name,
        price_usd: values.priceUsd,
        billing_interval: values.billingInterval,
        renewal_date: values.renewalDate,
        category: values.category,
        is_active: values.isActive,
        last_used_at: values.lastUsedAt,
      })
      .select(SUBSCRIPTION_COLUMNS)
      .single();
    if (error) {
      if (isMissingTableOrColumn(error)) {
        return serviceUnavailable(
          'Subscription tracking is not set up yet — the owner still needs to run the migration once.'
        );
      }
      if ((error as { code?: unknown }).code === '23505') {
        return validationError('A subscription with this name already exists.');
      }
      return internalError('Failed to add subscription');
    }
    const subscription = mapSubscriptionRow(data as Record<string, unknown>);
    if (!subscription) return internalError('Failed to add subscription');
    return apiSuccess({ subscription, subscriptionsEnabled: true }, 201);
  } catch {
    return internalError('Failed to add subscription');
  }
}

export async function PUT(request: NextRequest) {
  logApiRequest(request, { endpoint: 'tools.consumer-subscriptions.update' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`tools-consumer-subs:${auth.userId}`, 30);
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => null);
    const id = typeof (body as Record<string, unknown> | null)?.id === 'string'
      ? ((body as Record<string, unknown>).id as string).trim()
      : '';
    if (!id) return validationError('id is required.');
    const parsed = parseCreateBody(body);
    if (parsed.error) return parsed.error;
    const values = parsed.values!;

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('consumer_subscriptions')
      .update({
        name: values.name,
        price_usd: values.priceUsd,
        billing_interval: values.billingInterval,
        renewal_date: values.renewalDate,
        category: values.category,
        is_active: values.isActive,
        last_used_at: values.lastUsedAt,
      })
      .eq('id', id)
      .eq('user_id', auth.userId)
      .select(SUBSCRIPTION_COLUMNS)
      .maybeSingle();
    if (error) {
      if (isMissingTableOrColumn(error)) {
        return serviceUnavailable(
          'Subscription tracking is not set up yet — the owner still needs to run the migration once.'
        );
      }
      if ((error as { code?: unknown }).code === '23505') {
        return validationError('A subscription with this name already exists.');
      }
      return internalError('Failed to update subscription');
    }
    if (!data) return notFound('Subscription not found.');
    const subscription = mapSubscriptionRow(data as Record<string, unknown>);
    if (!subscription) return internalError('Failed to update subscription');
    return apiSuccess({ subscription, subscriptionsEnabled: true });
  } catch {
    return internalError('Failed to update subscription');
  }
}

export async function DELETE(request: NextRequest) {
  logApiRequest(request, { endpoint: 'tools.consumer-subscriptions.delete' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`tools-consumer-subs:${auth.userId}`, 30);
  if (limited) return limited;

  const id = request.nextUrl.searchParams.get('id')?.trim() ?? '';
  if (!id) return validationError('id is required.');

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('consumer_subscriptions')
      .delete()
      .eq('id', id)
      .eq('user_id', auth.userId)
      .select('id')
      .maybeSingle();
    if (error) {
      if (isMissingTableOrColumn(error)) {
        return serviceUnavailable(
          'Subscription tracking is not set up yet — the owner still needs to run the migration once.'
        );
      }
      return internalError('Failed to delete subscription');
    }
    if (!data) return notFound('Subscription not found.');
    return apiSuccess({ deleted: true, subscriptionsEnabled: true });
  } catch {
    return internalError('Failed to delete subscription');
  }
}
