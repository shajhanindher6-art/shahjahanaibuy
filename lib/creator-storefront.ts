/**
 * Creator storefronts (Section 6, Item 14 — trimmed).
 *
 * A storefront is a VIEW over existing rows, not a new profile
 * table: profiles.creator_slug + creator_bio (migration 033, both
 * user-supplied, NULL = no storefront), creator_rewards
 * (display_name / points / verified_deals), and community_deals
 * (verified-approved deals only — the same rule as
 * services/community-deals.ts: admin flag OR a merchant-price
 * match within 5%; upvotes never verify).
 *
 * No bios, follower counts, or earnings are ever invented: the bio
 * is the creator's own text (or absent), and nothing about revenue
 * share is displayed — computeRevenueShare returns null until the
 * owner configures it, so this module has no revenue field at all.
 *
 * Profiles read note: profiles RLS (`profiles_select_own`) hides
 * other users' rows from the anon client, so the slug lookup uses
 * the service-role client when it is configured — the same pattern
 * lib/api/middleware.ts `requireAdmin` uses to read profiles
 * server-side. The select is restricted to the three fields a
 * creator chose to publish (id, creator_slug, creator_bio); no
 * email or other profile data is ever read or returned. Without a
 * configured service key the lookup falls back to the passed client
 * and fail-safes to null/empty — the storefront simply reads as
 * "not found" until the key is set.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  badgeForVerifiedDeals,
  badgeLabel,
  rankLeaderboard,
  type LeaderboardEntry,
} from '@/lib/creator-rewards';
import { isDealVerified, type CommunityDealRow, type MerchantPriceRow } from '@/services/community-deals';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreatorDeal {
  id: string;
  productId: string | null;
  productSlug: string | null;
  productName: string;
  merchantName: string | null;
  price: number | null;
  dealText: string | null;
  couponCode: string | null;
  sourceUrl: string | null;
  createdAt: string;
  /** Always true here — only verified deals are ever returned. */
  verified: true;
}

export interface CreatorStorefront {
  userId: string;
  slug: string;
  bio: string | null;
  displayName: string | null;
  points: number;
  verifiedDeals: number;
  badge: string;
  badgeLabel: string;
  deals: CreatorDeal[];
}

export interface CreatorListEntry {
  userId: string;
  slug: string;
  displayName: string | null;
  points: number;
  verifiedDeals: number;
  badge: string;
  badgeLabel: string;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

/** A creator slug is 2–64 chars of lowercase letters, digits, and hyphens. */
export function isValidCreatorSlug(slug: unknown): boolean {
  if (typeof slug !== 'string') return false;
  const trimmed = slug.trim().toLowerCase();
  if (trimmed.length < 2 || trimmed.length > 64) return false;
  if (trimmed !== slug.trim()) return false;
  return SLUG_PATTERN.test(trimmed);
}

// ---------------------------------------------------------------------------
// Fail-safe reads
// ---------------------------------------------------------------------------

function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

function isMissingColumn(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42703';
}

/**
 * Verified-approved community deals for one creator, newest first.
 * Unverified and pending deals are excluded — never shown.
 */
export async function getVerifiedCreatorDeals(
  supabase: AnySupabaseClient,
  userId: string
): Promise<CreatorDeal[]> {
  try {
    const { data: deals, error } = await supabase
      .from('community_deals')
      .select(
        'id, user_id, author_name, product_id, product_name, merchant_id, merchant_name, price, deal_text, coupon_code, source_url, status, is_verified, created_at'
      )
      .eq('user_id', userId)
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) {
      if (isMissingTable(error)) return [];
      logger.warn('getVerifiedCreatorDeals: query failed', { error: error.message });
      return [];
    }
    const rows = (deals ?? []) as CommunityDealRow[];
    if (rows.length === 0) return [];

    const linked = rows.filter((d) => d.product_id && d.merchant_id);
    let merchantPrices: MerchantPriceRow[] = [];
    if (linked.length > 0) {
      const productIds = [...new Set(linked.map((d) => d.product_id as string))];
      const { data: mp } = await supabase
        .from('merchant_products')
        .select('merchant_id, product_id, price')
        .in('product_id', productIds);
      merchantPrices = ((mp ?? []) as Array<{ merchant_id: string; product_id: string; price: number }>).map(
        (r) => ({ merchant_id: r.merchant_id, product_id: r.product_id, price: Number(r.price) })
      );
    }

    const verified = rows.filter((d) => isDealVerified(d, merchantPrices));
    // Product slugs for links (product pages are addressed by slug).
    const slugByProduct = new Map<string, string>();
    const verifiedProductIds = [...new Set(verified.map((d) => d.product_id).filter((id): id is string => !!id))];
    if (verifiedProductIds.length > 0) {
      const { data: products } = await supabase
        .from('products')
        .select('id, slug')
        .in('id', verifiedProductIds)
        .is('deleted_at', null);
      for (const prod of (products ?? []) as Array<{ id: string; slug: string }>) {
        slugByProduct.set(prod.id, prod.slug);
      }
    }
    return verified.map((d) => ({
      id: d.id,
      productId: d.product_id,
      productSlug: d.product_id ? slugByProduct.get(d.product_id) ?? null : null,
      productName: d.product_name,
        merchantName: d.merchant_name,
        price: d.price,
        dealText: d.deal_text,
        couponCode: d.coupon_code,
        sourceUrl: d.source_url,
        createdAt: d.created_at,
        verified: true as const,
      }));
  } catch (err) {
    logger.error('getVerifiedCreatorDeals: unexpected error', { error: String(err) });
    return [];
  }
}

/**
 * One creator's public storefront by slug, or null when there is no
 * creator with that slug (or migration 033 has not been run yet).
 * A creator with no verified deals still resolves — with an empty
 * deals list, so the page renders "No verified deals yet".
 */
export async function getCreatorBySlug(
  supabase: AnySupabaseClient,
  slug: string
): Promise<CreatorStorefront | null> {
  if (!isValidCreatorSlug(slug)) return null;
  const normalized = slug.trim().toLowerCase();
  try {
    // Slug lookup needs cross-user profile reads (see module note).
    const reader = createSupabaseServiceClient() ?? supabase;
    const { data: profile, error: profileError } = await reader
      .from('profiles')
      .select('id, creator_slug, creator_bio')
      .eq('creator_slug', normalized)
      .maybeSingle();
    if (profileError) {
      if (isMissingTable(profileError) || isMissingColumn(profileError)) return null;
      logger.warn('getCreatorBySlug: profile lookup failed', { error: profileError.message });
      return null;
    }
    if (!profile) return null;
    const p = profile as { id: string; creator_slug: string | null; creator_bio: string | null };
    if (!p.creator_slug) return null;

    const { data: reward } = await supabase
      .from('creator_rewards')
      .select('display_name, points, verified_deals')
      .eq('user_id', p.id)
      .maybeSingle();
    const r = (reward ?? null) as { display_name: string | null; points: number; verified_deals: number } | null;
    const verifiedDeals = r?.verified_deals ?? 0;
    const badge = badgeForVerifiedDeals(verifiedDeals);
    const deals = await getVerifiedCreatorDeals(supabase, p.id);
    return {
      userId: p.id,
      slug: p.creator_slug,
      bio: p.creator_bio ?? null,
      displayName: r?.display_name ?? null,
      points: r?.points ?? 0,
      verifiedDeals,
      badge,
      badgeLabel: badgeLabel(badge),
      deals,
    };
  } catch (err) {
    logger.error('getCreatorBySlug: unexpected error', { error: String(err) });
    return null;
  }
}

/**
 * Top creators with a public slug and at least one verified deal,
 * ranked by the shared leaderboard rule (points desc, then verified
 * deals desc). Creators without a slug, or with no verified deals,
 * have no storefront to list and are excluded. Returns [] when the
 * rewards table (migration 031) or the 033 slug columns are missing.
 */
export async function getTopCreators(
  supabase: AnySupabaseClient,
  limit = 20
): Promise<CreatorListEntry[]> {
  try {
    const { data, error } = await supabase
      .from('creator_rewards')
      .select('user_id, display_name, points, verified_deals, badge')
      .order('points', { ascending: false })
      .order('verified_deals', { ascending: false })
      .limit(Math.max(1, Math.min(50, Math.floor(limit) || 20)));
    if (error) {
      if (isMissingTable(error)) return [];
      logger.warn('getTopCreators: query failed', { error: error.message });
      return [];
    }
    const entries: LeaderboardEntry[] = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      userId: row.user_id as string,
      displayName: (row.display_name as string | null) ?? null,
      points: (row.points as number) ?? 0,
      verifiedDeals: (row.verified_deals as number) ?? 0,
      badge: badgeForVerifiedDeals((row.verified_deals as number) ?? 0),
    }));
    const ranked = rankLeaderboard(entries);
    if (ranked.length === 0) return [];

    // Resolve slugs (cross-user read — see module note).
    const reader = createSupabaseServiceClient() ?? supabase;
    const { data: profiles, error: profilesError } = await reader
      .from('profiles')
      .select('id, creator_slug')
      .in('id', ranked.map((e) => e.userId))
      .not('creator_slug', 'is', null);
    if (profilesError) {
      if (isMissingTable(profilesError) || isMissingColumn(profilesError)) return [];
      logger.warn('getTopCreators: slug lookup failed', { error: profilesError.message });
      return [];
    }
    const slugByUser = new Map<string, string>();
    for (const row of (profiles ?? []) as Array<{ id: string; creator_slug: string | null }>) {
      if (row.creator_slug) slugByUser.set(row.id, row.creator_slug);
    }
    return ranked
      .filter((e) => e.verifiedDeals > 0 && slugByUser.has(e.userId))
      .map((e) => ({
        userId: e.userId,
        slug: slugByUser.get(e.userId) as string,
        displayName: e.displayName,
        points: e.points,
        verifiedDeals: e.verifiedDeals,
        badge: e.badge,
        badgeLabel: badgeLabel(e.badge),
      }));
  } catch (err) {
    logger.error('getTopCreators: unexpected error', { error: String(err) });
    return [];
  }
}
