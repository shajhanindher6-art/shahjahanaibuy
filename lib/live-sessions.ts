/**
 * Live shopping sessions (Section 6 item 6 — trimmed).
 *
 * Sessions, NOT streaming: SmartBuy never hosts or embeds a video
 * stream. A session records a scheduled time and, once the host has
 * one, a link OUT to the provider's stream URL (YouTube / Instagram /
 * TikTok / the retailer's own live page). The page renders that URL
 * as an external link only — never an iframe, so no CSP change.
 *
 * Status is DERIVED from dates + stream_url presence, never a
 * hand-set is_live flag:
 *   - 'ended'               — now is at/past ends_at (when recorded)
 *   - 'live_now'            — started, not ended, stream_url recorded
 *   - 'upcoming'            — starts in the future, stream_url recorded
 *   - 'scheduled_no_stream' — scheduled (future or started) but no
 *                             stream_url recorded yet
 * No viewer counts, no sales counts, no invented schedule: until
 * migration 033 runs, every read returns an honest empty state
 * (liveEnabled: false).
 *
 * 'Notify me' reuses the existing price-drop alert chain — there is
 * no separate live-session alert type.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { getProductById } from '@/services/products';
import { getMerchantProducts } from '@/services/commerce';
import type { Product } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LiveSessionStatus = 'upcoming' | 'live_now' | 'ended' | 'scheduled_no_stream';

export interface LiveSession {
  id: string;
  title: string;
  slug: string;
  startsAt: string;
  endsAt: string | null;
  streamUrl: string | null;
  hostNote: string | null;
  createdAt: string;
}

export interface LiveSessionWithStatus extends LiveSession {
  status: LiveSessionStatus;
}

export interface LiveSessionProduct {
  product: Product;
  /** Lowest recorded in-stock merchant price, or null when no merchant listing exists. */
  lowestPrice: number | null;
  currencyId: string | null;
  inStock: boolean;
}

export interface LiveSessionsResult {
  sessions: LiveSessionWithStatus[];
  /** False until migration 033 (live_shopping_sessions) has been run. */
  liveEnabled: boolean;
}

export interface LiveSessionDetailResult {
  session: LiveSessionWithStatus | null;
  products: LiveSessionProduct[];
  liveEnabled: boolean;
}

interface LiveSessionRow {
  id: string;
  title: string;
  slug: string;
  starts_at: string;
  ends_at: string | null;
  stream_url: string | null;
  host_note: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Pure helpers (no DB, no network — unit-tested)
// ---------------------------------------------------------------------------

/**
 * Derive a session's status from its dates + stream_url presence only.
 * `now` is injectable so boundary behaviour is testable.
 *
 * Boundaries: at exactly starts_at the session has started; at exactly
 * ends_at it has ended.
 */
export function deriveSessionStatus(
  session: { startsAt: string; endsAt: string | null; streamUrl: string | null },
  now: Date = new Date()
): LiveSessionStatus {
  const nowMs = now.getTime();
  const startsMs = new Date(session.startsAt).getTime();
  const endsMs = session.endsAt ? new Date(session.endsAt).getTime() : null;
  const hasStream = typeof session.streamUrl === 'string' && session.streamUrl.trim().length > 0;

  if (endsMs !== null && !Number.isNaN(endsMs) && nowMs >= endsMs) return 'ended';
  if (!Number.isNaN(startsMs) && nowMs >= startsMs) {
    return hasStream ? 'live_now' : 'scheduled_no_stream';
  }
  return hasStream ? 'upcoming' : 'scheduled_no_stream';
}

/** Human label for a derived status (used by pages + API responses). */
export function liveSessionStatusLabel(status: LiveSessionStatus): string {
  switch (status) {
    case 'live_now':
      return 'Live now';
    case 'upcoming':
      return 'Upcoming';
    case 'ended':
      return 'Ended';
    case 'scheduled_no_stream':
      return 'Scheduled — no stream yet';
  }
}

/** Slugs are URL segments: lowercase letters, digits, single hyphens. */
export function isValidLiveSessionSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

// ---------------------------------------------------------------------------
// Fail-safe reads
// ---------------------------------------------------------------------------

// PostgREST reports a table missing from its schema cache as PGRST205
// (not Postgres 42P01) on the REST path, so both codes must count as
// "migration not run yet" — otherwise a missing table surfaces as a
// generic error instead of the honest liveEnabled:false flag.
export function isMissingTableError(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

function mapSession(row: LiveSessionRow): LiveSession {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    streamUrl: row.stream_url,
    hostNote: row.host_note,
    createdAt: row.created_at,
  };
}

function withStatus(session: LiveSession, now: Date = new Date()): LiveSessionWithStatus {
  return { ...session, status: deriveSessionStatus(session, now) };
}

const SESSION_COLUMNS =
  'id, title, slug, starts_at, ends_at, stream_url, host_note, created_at';

/**
 * List all sessions, soonest first. Missing table (migration 033 not
 * run) → { sessions: [], liveEnabled: false }, never a throw.
 */
export async function getLiveSessions(
  supabase: AnySupabaseClient,
  now: Date = new Date()
): Promise<LiveSessionsResult> {
  try {
    const { data, error } = await supabase
      .from('live_shopping_sessions')
      .select(SESSION_COLUMNS)
      .order('starts_at', { ascending: true })
      .limit(100);
    if (error) {
      if (isMissingTableError(error)) return { sessions: [], liveEnabled: false };
      logger.warn('getLiveSessions: query failed', { error: error.message });
      return { sessions: [], liveEnabled: true };
    }
    const sessions = ((data ?? []) as LiveSessionRow[]).map((r) => withStatus(mapSession(r), now));
    return { sessions, liveEnabled: true };
  } catch (err) {
    logger.error('getLiveSessions: unexpected error', { error: String(err) });
    return { sessions: [], liveEnabled: false };
  }
}

/**
 * One session by slug. Returns liveEnabled:false (session null) when
 * migration 033 has not been run; null session + liveEnabled:true
 * means the table exists but no session has that slug.
 */
export async function getLiveSessionBySlug(
  supabase: AnySupabaseClient,
  slug: string,
  now: Date = new Date()
): Promise<{ session: LiveSessionWithStatus | null; liveEnabled: boolean }> {
  try {
    const { data, error } = await supabase
      .from('live_shopping_sessions')
      .select(SESSION_COLUMNS)
      .eq('slug', slug)
      .maybeSingle();
    if (error) {
      if (isMissingTableError(error)) return { session: null, liveEnabled: false };
      logger.warn('getLiveSessionBySlug: query failed', { error: error.message });
      return { session: null, liveEnabled: true };
    }
    if (!data) return { session: null, liveEnabled: true };
    return { session: withStatus(mapSession(data as LiveSessionRow), now), liveEnabled: true };
  } catch (err) {
    logger.error('getLiveSessionBySlug: unexpected error', { error: String(err) });
    return { session: null, liveEnabled: false };
  }
}

/**
 * Linked catalog products for a session, each with its REAL current
 * lowest in-stock merchant price (re-read from merchant_products at
 * view time — never a stored or invented price). A linked product
 * with no merchant listing is still listed, with lowestPrice null
 * and an honest "no current price recorded" note on the page.
 * Missing link table → [] (fail-safe, same as the session reads).
 */
export async function getLiveSessionProducts(
  supabase: AnySupabaseClient,
  sessionId: string
): Promise<LiveSessionProduct[]> {
  try {
    const { data, error } = await supabase
      .from('live_session_products')
      .select('product_id')
      .eq('session_id', sessionId);
    if (error) {
      if (isMissingTableError(error)) return [];
      logger.warn('getLiveSessionProducts: query failed', { error: error.message });
      return [];
    }
    const productIds = ((data ?? []) as Array<{ product_id: string }>).map((r) => r.product_id);
    const results: LiveSessionProduct[] = [];
    for (const productId of productIds) {
      const product = await getProductById(supabase, productId);
      if (!product) continue;
      const listings = await getMerchantProducts(supabase, productId);
      const inStock = listings.filter((l) => l.inStock);
      const cheapest = (inStock.length > 0 ? inStock : listings)[0] ?? null;
      results.push({
        product,
        lowestPrice: cheapest ? cheapest.price : null,
        currencyId: cheapest ? cheapest.currencyId : null,
        inStock: inStock.length > 0,
      });
    }
    return results;
  } catch (err) {
    logger.error('getLiveSessionProducts: unexpected error', { error: String(err) });
    return [];
  }
}

/** Session + its linked products in one call (detail route + page). */
export async function getLiveSessionDetail(
  supabase: AnySupabaseClient,
  slug: string,
  now: Date = new Date()
): Promise<LiveSessionDetailResult> {
  const { session, liveEnabled } = await getLiveSessionBySlug(supabase, slug, now);
  if (!session) return { session: null, products: [], liveEnabled };
  const products = await getLiveSessionProducts(supabase, session.id);
  return { session, products, liveEnabled };
}
