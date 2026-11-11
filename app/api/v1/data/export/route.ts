/**
 * API v1 data export — Section 14, Chunk 7.
 * GET /api/v1/data/export — the signed-in user's own data as one
 * JSON document (see lib/data-export.ts for the shape). Every
 * section is read from the user's own rows only; a section whose
 * table is not set up yet (migration not run) comes back empty
 * instead of failing the whole export. No secrets are ever
 * included: no API keys, no push subscription endpoints, no
 * tokens. Rate-limited to 5 exports per hour per user.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  internalError,
} from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, requireAuth } from '@/lib/api/middleware';
import {
  buildExportDocument,
  buildExportSection,
  emptyExportSection,
  type UserDataExport,
} from '@/lib/data-export';
import { isMissingTableError } from '@/lib/buy-list';

export const dynamic = 'force-dynamic';

const EXPORT_LIMIT = 500;

type Row = Record<string, unknown>;

async function readSection(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  table: string,
  columns: string,
  userId: string,
  orderBy = 'created_at'
): Promise<Row[]> {
  try {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq('user_id', userId)
      .order(orderBy, { ascending: false })
      .limit(EXPORT_LIMIT);
    if (error) return [];
    return (data ?? []) as unknown as Row[];
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'data.export' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`data-export:${auth.userId}`, 5, 3_600_000);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const userId = auth.userId;

    // Profile is keyed by id (= auth user id), not user_id.
    let profileRows: Row[] = [];
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, avatar_url, bio, created_at')
        .eq('id', userId)
        .limit(1);
      if (!error && data) profileRows = data as Row[];
    } catch {
      profileRows = [];
    }

    const wishlists = await readSection(
      supabase,
      'wishlists',
      'id, name, description, is_public, created_at',
      userId
    );
    const wishlistIds = wishlists
      .map((w) => w.id)
      .filter((id): id is string => typeof id === 'string');

    // Wishlist items have no user_id column — read by the user's
    // wishlist ids. A missing table is an empty section, never an
    // error (same fail-safe as the other sections).
    let wishlistItems: Row[] = [];
    if (wishlistIds.length > 0) {
      try {
        const { data, error } = await supabase
          .from('wishlist_items')
          .select('id, wishlist_id, product_id, notes, target_price, added_at')
          .in('wishlist_id', wishlistIds)
          .order('added_at', { ascending: false })
          .limit(EXPORT_LIMIT);
        if (!error && data) wishlistItems = data as Row[];
        else if (error && !isMissingTableError(error)) wishlistItems = [];
      } catch {
        wishlistItems = [];
      }
    }

    const [alerts, buyList, savings, searchHistory, referralLinks] = await Promise.all([
      readSection(
        supabase,
        'alerts',
        'id, product_id, alert_type, condition_value, channel, active, created_at',
        userId
      ),
      readSection(
        supabase,
        'buy_list_items',
        'id, product_id, merchant_product_id, quantity, created_at',
        userId
      ),
      readSection(
        supabase,
        'savings_events',
        'id, product_id, alert_id, amount_saved_usd, basis, recorded_at',
        userId,
        'recorded_at'
      ),
      readSection(
        supabase,
        'search_history',
        'id, query, results_count, created_at',
        userId
      ),
      readSection(
        supabase,
        'referral_links',
        'code, click_count, created_at',
        userId
      ),
    ]);

    const sections: UserDataExport['sections'] = {
      profile: profileRows.length > 0 ? buildExportSection(profileRows) : emptyExportSection(),
      wishlists: buildExportSection(wishlists),
      wishlistItems: buildExportSection(wishlistItems),
      alerts: buildExportSection(alerts),
      buyList: buildExportSection(buyList),
      savings: buildExportSection(savings),
      searchHistory: buildExportSection(searchHistory),
      referralLinks: buildExportSection(referralLinks),
    };

    return apiSuccess(buildExportDocument(userId, sections));
  } catch {
    return internalError('Failed to build data export');
  }
}
