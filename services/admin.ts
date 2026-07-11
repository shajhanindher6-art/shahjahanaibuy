/**
 * Admin panel service.
 * Provides admin-only data access for user management, analytics, and system logs.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import type { AdminAnalytics, AdminAuditLog } from '@/types/ai';

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

export async function getAllUsers(
  supabase: AnySupabaseClient,
  page = 1,
  pageSize = 20
): Promise<{ users: Array<Record<string, unknown>>; total: number; page: number; pageSize: number }> {
  const offset = (Math.max(1, page) - 1) * Math.min(100, Math.max(1, pageSize));
  try {
    const { data, error, count } = await supabase
      .from('profiles')
      .select('id, user_id, email, full_name, avatar_url, bio, role, created_at, updated_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + Math.min(100, pageSize) - 1);

    if (error) {
      logger.warn('getAllUsers: query failed', { error: error.message });
      return { users: [], total: 0, page, pageSize };
    }

    return { users: (data ?? []) as Array<Record<string, unknown>>, total: count ?? 0, page, pageSize };
  } catch (err) {
    logger.error('getAllUsers: unexpected error', { error: String(err) });
    return { users: [], total: 0, page, pageSize };
  }
}
