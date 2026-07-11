/**
 * Affiliate system service.
 * Manages affiliate links, click tracking, and conversion monitoring.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';

export interface AffiliateLink {
  id: string;
  productId: string;
  retailerName: string;
  originalUrl: string;
  affiliateUrl: string;
  commissionRate: number;
  clicksCount: number;
  conversionsCount: number;
  revenueGenerated: number;
  active: boolean;
}

const RETAILER_AFFILIATE_CONFIG: Record<string, { tagParam: string; tagValue: string }> = {
  amazon: { tagParam: 'tag', tagValue: 'smartbuyai-20' },
  ebay: { tagParam: 'campid', tagValue: '5338342075' },
  walmart: { tagParam: 'affp1', tagValue: 'smartbuyai' },
  aliexpress: { tagParam: 'aff_fcid', tagValue: 'smartbuyai' },
  bestbuy: { tagParam: 'irclickid', tagValue: 'smartbuyai-20' },
};

export function buildAffiliateUrl(originalUrl: string, retailerName: string): string {
  const config = RETAILER_AFFILIATE_CONFIG[retailerName.toLowerCase()];
  if (!config) return originalUrl;

  try {
    const url = new URL(originalUrl);
    url.searchParams.set(config.tagParam, config.tagValue);
    return url.toString();
  } catch {
    return originalUrl;
  }
}

export async function getAffiliateLinks(
  supabase: AnySupabaseClient,
  productId: string
): Promise<AffiliateLink[]> {
  try {
    const { data, error } = await supabase
      .from('affiliate_links')
      .select('id, product_id, retailer_name, original_url, affiliate_url, commission_rate, clicks_count, conversions_count, revenue_generated, active')
      .eq('product_id', productId)
      .eq('active', true)
      .order('commission_rate', { ascending: false });

    if (error || !data) {
      if (error) logger.warn('getAffiliateLinks: query failed', { error: error.message });
      return [];
    }

    return (data as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      productId: row.product_id as string,
      retailerName: row.retailer_name as string,
      originalUrl: row.original_url as string,
      affiliateUrl: row.affiliate_url as string,
      commissionRate: parseFloat(String(row.commission_rate)),
      clicksCount: row.clicks_count as number,
      conversionsCount: row.conversions_count as number,
      revenueGenerated: parseFloat(String(row.revenue_generated)),
      active: row.active as boolean,
    }));
  } catch (err) {
    logger.error('getAffiliateLinks: unexpected error', { error: String(err) });
    return [];
  }
}

export async function trackAffiliateClick(
  supabase: AnySupabaseClient,
  affiliateLinkId: string,
  productId: string,
  retailerName: string,
  clickedPrice?: number,
  userId?: string
): Promise<boolean> {
  try {
    const { error: clickError } = await supabase.from('affiliate_clicks').insert({
      affiliate_link_id: affiliateLinkId,
      user_id: userId ?? null,
      product_id: productId,
      retailer_name: retailerName,
      clicked_price: clickedPrice ?? null,
    });

    if (clickError) {
      logger.warn('trackAffiliateClick: insert failed', { error: clickError.message });
      return false;
    }

    const { data: link } = await supabase
      .from('affiliate_links')
      .select('clicks_count')
      .eq('id', affiliateLinkId)
      .maybeSingle();

    if (link) {
      const currentCount = (link as Record<string, unknown>).clicks_count as number;
      await supabase
        .from('affiliate_links')
        .update({ clicks_count: currentCount + 1, updated_at: new Date().toISOString() })
        .eq('id', affiliateLinkId);
    }

    return true;
  } catch (err) {
    logger.error('trackAffiliateClick: unexpected error', { error: String(err) });
    return false;
  }
}

export async function getAffiliateAnalytics(
  supabase: AnySupabaseClient
): Promise<{ totalClicks: number; totalConversions: number; totalRevenue: number; topRetailers: Array<{ name: string; clicks: number; revenue: number }> }> {
  try {
    const { data, error } = await supabase
      .from('affiliate_links')
      .select('retailer_name, clicks_count, conversions_count, revenue_generated')
      .eq('active', true);

    if (error || !data) {
      return { totalClicks: 0, totalConversions: 0, totalRevenue: 0, topRetailers: [] };
    }

    const links = data as Array<Record<string, unknown>>;
    const totalClicks = links.reduce((sum, l) => sum + (l.clicks_count as number), 0);
    const totalConversions = links.reduce((sum, l) => sum + (l.conversions_count as number), 0);
    const totalRevenue = links.reduce((sum, l) => sum + parseFloat(String(l.revenue_generated)), 0);

    const retailerMap = new Map<string, { clicks: number; revenue: number }>();
    for (const l of links) {
      const name = l.retailer_name as string;
      const existing = retailerMap.get(name) ?? { clicks: 0, revenue: 0 };
      existing.clicks += l.clicks_count as number;
      existing.revenue += parseFloat(String(l.revenue_generated));
      retailerMap.set(name, existing);
    }

    const topRetailers = Array.from(retailerMap.entries())
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    return { totalClicks, totalConversions, totalRevenue, topRetailers };
  } catch (err) {
    logger.error('getAffiliateAnalytics: unexpected error', { error: String(err) });
    return { totalClicks: 0, totalConversions: 0, totalRevenue: 0, topRetailers: [] };
  }
}
