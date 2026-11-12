/**
 * Admin panel service.
 * Provides admin-only data access for user management, analytics, and system logs.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { resolveRoleName, type ProfileRoleRow } from '@/lib/admin-role';
import type { AdminAnalytics, AdminAuditLog } from '@/types/ai';
import {
  analyzeAffiliateClicks,
  type AffiliateClickAnalytics,
  type AffiliateClickRow,
} from '@/services/affiliate-analytics';

export async function getAdminAnalytics(
  supabase: AnySupabaseClient
): Promise<AdminAnalytics> {
  try {
    const [usersCount, productsCount, alertsCount, dealsCount, wishlistsCount, searchesCount] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('products').select('*', { count: 'exact', head: true }).is('deleted_at', null),
      supabase.from('alerts').select('*', { count: 'exact', head: true }),
      supabase.from('deals').select('*', { count: 'exact', head: true }).eq('active', true).is('deleted_at', null),
      supabase.from('wishlists').select('*', { count: 'exact', head: true }),
      supabase.from('search_history').select('*', { count: 'exact', head: true }),
    ]);

    const totalUsers = usersCount.count ?? 0;
    const totalProducts = productsCount.count ?? 0;
    const totalAlerts = alertsCount.count ?? 0;
    const activeDeals = dealsCount.count ?? 0;
    const totalWishlists = wishlistsCount.count ?? 0;
    const totalSearches = searchesCount.count ?? 0;

    const { data: topSearches } = await supabase
      .from('search_history')
      .select('query')
      .order('created_at', { ascending: false })
      .limit(500);

    const searchCounts = new Map<string, number>();
    for (const row of (topSearches ?? []) as Array<Record<string, unknown>>) {
      const q = row.query as string;
      searchCounts.set(q, (searchCounts.get(q) ?? 0) + 1);
    }
    const topSearched = Array.from(searchCounts.entries())
      .map(([query, count]) => ({ query, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const { data: topProducts } = await supabase
      .from('products')
      .select('name, view_count')
      .is('deleted_at', null)
      .order('view_count', { ascending: false })
      .limit(10);

    const topProductsArr = (topProducts ?? []) as Array<Record<string, unknown>>;
    const topProductsList = topProductsArr.map((r) => ({
      name: r.name as string,
      views: r.view_count as number,
    }));

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count: recentSignups } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', weekAgo);

    return {
      totalUsers,
      totalProducts,
      totalAlerts,
      activeDeals,
      totalWishlists,
      totalSearches,
      topSearched,
      topProducts: topProductsList,
      recentSignups: recentSignups ?? 0,
    };
  } catch (err) {
    logger.error('getAdminAnalytics: unexpected error', { error: String(err) });
    return {
      totalUsers: 0,
      totalProducts: 0,
      totalAlerts: 0,
      activeDeals: 0,
      totalWishlists: 0,
      totalSearches: 0,
      topSearched: [],
      topProducts: [],
      recentSignups: 0,
    };
  }
}

export async function getAdminAuditLogs(
  supabase: AnySupabaseClient,
  limit = 50
): Promise<AdminAuditLog[]> {
  try {
    const { data, error } = await supabase
      .from('admin_audit_logs')
      .select('id, admin_id, action, target_type, target_id, details, ip_address, created_at')
      .order('created_at', { ascending: false })
      .limit(Math.min(200, limit));

    if (error || !data) {
      if (error) logger.warn('getAdminAuditLogs: query failed', { error: error.message });
      return [];
    }

    return (data as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      adminId: row.admin_id as string,
      action: row.action as string,
      targetType: row.target_type as string,
      targetId: row.target_id as string | null,
      details: row.details as Record<string, unknown> | null,
      ipAddress: row.ip_address as string | null,
      createdAt: row.created_at as string,
    }));
  } catch (err) {
    logger.error('getAdminAuditLogs: unexpected error', { error: String(err) });
    return [];
  }
}

export async function recordAdminAction(
  supabase: AnySupabaseClient,
  adminId: string,
  action: string,
  targetType: string,
  targetId: string | null,
  details: Record<string, unknown> | null,
  ipAddress: string | null
): Promise<void> {
  try {
    const { error } = await supabase.from('admin_audit_logs').insert({
      admin_id: adminId,
      action,
      target_type: targetType,
      target_id: targetId,
      details,
      ip_address: ipAddress,
    });

    if (error) logger.warn('recordAdminAction: insert failed', { error: error.message });
  } catch (err) {
    logger.error('recordAdminAction: unexpected error', { error: String(err) });
  }
}

/**
 * Geo-click analytics for the admin dashboard — Step C.
 * Reads `affiliate_geo_clicks` (service-role client; the table has no
 * anon read policy by design) and aggregates with the pure analyzer
 * in services/affiliate-analytics.ts. The fetch is capped at 5,000
 * rows per range — far above today's volume; if real traffic ever
 * approaches it, move the aggregation into a DB view/RPC instead of
 * raising the cap silently. On any DB error returns an honest empty
 * result, never a fabricated one.
 */
export async function getAffiliateClickAnalytics(
  supabase: AnySupabaseClient,
  days = 30
): Promise<AffiliateClickAnalytics> {
  const safeDays = days === 7 || days === 90 ? days : 30;
  const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString();
  try {
    const { data, error } = await supabase
      .from('affiliate_geo_clicks')
      .select('product_slug, retailer_name, target_url, country_code, clicked_at')
      .gte('clicked_at', since)
      .order('clicked_at', { ascending: false })
      .limit(5000);

    if (error) {
      logger.warn('getAffiliateClickAnalytics: query failed', { error: error.message });
      return analyzeAffiliateClicks([], safeDays);
    }

    return analyzeAffiliateClicks((data ?? []) as AffiliateClickRow[], safeDays);
  } catch (err) {
    logger.error('getAffiliateClickAnalytics: unexpected error', { error: String(err) });
    return analyzeAffiliateClicks([], safeDays);
  }
}

export async function getAllUsers(
  supabase: AnySupabaseClient,
  page = 1,
  pageSize = 20
): Promise<{ users: Array<Record<string, unknown>>; total: number; page: number; pageSize: number }> {
  const offset = (Math.max(1, page) - 1) * Math.min(100, Math.max(1, pageSize));
  try {
    // Section 17, Stage H, item 7 (audit §4 #1): the role is resolved
    // via `role_id → roles.name` — `profiles` has NO `role` column in
    // the migration chain, so selecting `role` errored and this
    // returned []. The returned rows keep the flat `role` string the
    // admin users page renders (`user.role`), resolved from the join.
    const { data, error, count } = await supabase
      .from('profiles')
      .select('id, user_id, email, full_name, avatar_url, bio, role_id, roles ( name ), created_at, updated_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + Math.min(100, pageSize) - 1);

    if (error) {
      logger.warn('getAllUsers: query failed', { error: error.message });
      return { users: [], total: 0, page, pageSize };
    }

    const users = ((data ?? []) as Array<Record<string, unknown> & ProfileRoleRow>).map((row) => {
      const { roles: _roles, ...rest } = row;
      return { ...rest, role: resolveRoleName(row) };
    });
    return { users, total: count ?? 0, page, pageSize };
  } catch (err) {
    logger.error('getAllUsers: unexpected error', { error: String(err) });
    return { users: [], total: 0, page, pageSize };
  }
}
