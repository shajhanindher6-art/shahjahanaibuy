/**
 * Save + dismiss feedback for recommendations (Section 19, Phase 4,
 * §12 #41/#42).
 *
 * STORE (no new migration — the task forbids one, and no existing
 * table has a (user, product, feedback) shape):
 *
 * Saved recommendations and dismissals live in the user's own
 * wishlists (migration 006, long applied — the one user-owned
 * store with a per-product row and a UNIQUE (wishlist_id,
 * product_id) guard against duplicates):
 * - "Saved recommendations" — products the user explicitly saved
 *   from a recommendation. Shown on the dashboard recommendations
 *   page and in /dashboard/wishlists like any other list.
 * - "Not interested" — products the user dismissed. `getRecommendations`
 *   reads these ids and never recommends them again to the same
 *   user, so the feedback loop is real, not a dead button.
 *
 * LIMITATION (documented, not hidden): feedback is wishlist
 * membership, not a dedicated `recommendation_feedback` table. A
 * thumbs-up/down or a reason ("too expensive", "wrong brand") has
 * nowhere to live — `wishlist_items.notes` could carry it, but
 * notes are user-visible on the wishlist page, so feedback text
 * would leak there. The proper home is a future migration adding
 * `recommendation_feedback (user_id, product_id, feedback,
 * reason, created_at)`; until the owner approves it, save/dismiss
 * is what this store can honestly express. Deleting either
 * wishlist deletes the feedback with it (ON DELETE CASCADE), and
 * account deletion removes both lists with the rest of the
 * wishlists (lib/account-deletion.ts).
 *
 * All functions are fail-safe: a missing table or a failed write
 * returns null/false/[], never throws, so the recommendations page
 * never breaks because feedback storage is unavailable.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import type { Wishlist } from '@/types/catalog';
import {
  addWishlistItem,
  createWishlist,
  getWishlistItems,
  getWishlists,
} from '@/services/wishlists';

export const SAVED_RECOMMENDATIONS_WISHLIST_NAME = 'Saved recommendations';
export const NOT_INTERESTED_WISHLIST_NAME = 'Not interested';

export interface SavedRecommendation {
  productId: string;
  name: string;
  slug: string;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
  addedAt: string;
}

async function findOrCreateFeedbackWishlist(
  supabase: AnySupabaseClient,
  userId: string,
  name: string
): Promise<Wishlist | null> {
  try {
    const lists = await getWishlists(supabase, userId);
    const existing = lists.find((w) => w.name === name);
    if (existing) return existing;
    return await createWishlist(supabase, userId, {
      name,
      description:
        name === SAVED_RECOMMENDATIONS_WISHLIST_NAME
          ? 'Recommendations you saved.'
          : 'Recommendations you dismissed — these are never recommended to you again.',
    });
  } catch (err) {
    logger.warn('recommendation-feedback: wishlist lookup failed', { error: String(err) });
    return null;
  }
}

async function findFeedbackItemId(
  supabase: AnySupabaseClient,
  userId: string,
  wishlistId: string,
  productId: string
): Promise<string | null> {
  const items = await getWishlistItems(supabase, wishlistId, userId);
  return items.find((i) => i.productId === productId)?.id ?? null;
}

async function addToFeedbackWishlist(
  supabase: AnySupabaseClient,
  userId: string,
  wishlistName: string,
  productId: string
): Promise<{ added: boolean; alreadyThere: boolean } | null> {
  try {
    const list = await findOrCreateFeedbackWishlist(supabase, userId, wishlistName);
    if (!list) return null;
    const existingId = await findFeedbackItemId(supabase, userId, list.id, productId);
    if (existingId) return { added: false, alreadyThere: true };
    const added = await addWishlistItem(supabase, list.id, userId, productId);
    if (!added) return null;
    return { added: true, alreadyThere: false };
  } catch (err) {
    logger.warn('recommendation-feedback: add failed', { error: String(err) });
    return null;
  }
}

async function removeFromFeedbackWishlist(
  supabase: AnySupabaseClient,
  userId: string,
  wishlistName: string,
  productId: string
): Promise<boolean> {
  try {
    const lists = await getWishlists(supabase, userId);
    const list = lists.find((w) => w.name === wishlistName);
    if (!list) return false;
    const itemId = await findFeedbackItemId(supabase, userId, list.id, productId);
    if (!itemId) return false;
    // Own-only by construction: the list was read through the
    // user's own wishlists, and getWishlistItems re-verified
    // ownership before returning the item id.
    const { error } = await supabase.from('wishlist_items').delete().eq('id', itemId);
    if (error) {
      logger.warn('recommendation-feedback: remove failed', { error: error.message });
      return false;
    }
    return true;
  } catch (err) {
    logger.warn('recommendation-feedback: remove failed', { error: String(err) });
    return false;
  }
}

/** Save a recommended product. Idempotent — saving twice is a no-op. */
export async function saveRecommendation(
  supabase: AnySupabaseClient,
  userId: string,
  productId: string
): Promise<{ saved: boolean; alreadySaved: boolean } | null> {
  const result = await addToFeedbackWishlist(
    supabase,
    userId,
    SAVED_RECOMMENDATIONS_WISHLIST_NAME,
    productId
  );
  if (!result) return null;
  return { saved: result.added, alreadySaved: result.alreadyThere };
}

/** Remove a product from the saved recommendations. */
export async function unsaveRecommendation(
  supabase: AnySupabaseClient,
  userId: string,
  productId: string
): Promise<boolean> {
  return removeFromFeedbackWishlist(
    supabase,
    userId,
    SAVED_RECOMMENDATIONS_WISHLIST_NAME,
    productId
  );
}

/**
 * Dismiss a recommended product. The product lands in the user's
 * "Not interested" list, and `getRecommendations` excludes it from
 * then on — the dismiss button feeds back into the engine.
 */
export async function dismissRecommendation(
  supabase: AnySupabaseClient,
  userId: string,
  productId: string
): Promise<{ dismissed: boolean; alreadyDismissed: boolean } | null> {
  const result = await addToFeedbackWishlist(
    supabase,
    userId,
    NOT_INTERESTED_WISHLIST_NAME,
    productId
  );
  if (!result) return null;
  return { dismissed: result.added, alreadyDismissed: result.alreadyThere };
}

/** Undo a dismiss — the product becomes recommendable again. */
export async function undismissRecommendation(
  supabase: AnySupabaseClient,
  userId: string,
  productId: string
): Promise<boolean> {
  return removeFromFeedbackWishlist(
    supabase,
    userId,
    NOT_INTERESTED_WISHLIST_NAME,
    productId
  );
}

/**
 * Product ids the user dismissed. Read by `getRecommendations` on
 * every call — a dismissed product is excluded even if it would
 * otherwise score highest. Empty when the user dismissed nothing
 * (or the store is unavailable), never an error.
 */
export async function getDismissedProductIds(
  supabase: AnySupabaseClient,
  userId: string
): Promise<string[]> {
  try {
    const lists = await getWishlists(supabase, userId);
    const list = lists.find((w) => w.name === NOT_INTERESTED_WISHLIST_NAME);
    if (!list) return [];
    const items = await getWishlistItems(supabase, list.id, userId);
    return items.map((i) => i.productId).filter(Boolean);
  } catch (err) {
    logger.warn('recommendation-feedback: dismissed read failed', { error: String(err) });
    return [];
  }
}

/** The user's saved recommendations, newest first, with product rows. */
export async function listSavedRecommendations(
  supabase: AnySupabaseClient,
  userId: string
): Promise<SavedRecommendation[]> {
  try {
    const lists = await getWishlists(supabase, userId);
    const list = lists.find((w) => w.name === SAVED_RECOMMENDATIONS_WISHLIST_NAME);
    if (!list) return [];
    const items = await getWishlistItems(supabase, list.id, userId);
    if (items.length === 0) return [];
    const productIds = items.map((i) => i.productId);
    const { data, error } = await supabase
      .from('products')
      .select('id, name, slug, brand, category, image_url')
      .in('id', productIds)
      .is('deleted_at', null);
    if (error || !data) return [];
    const byId = new Map(
      (data as Array<Record<string, unknown>>).map((row) => [row.id as string, row])
    );
    return items
      .map((item) => {
        const row = byId.get(item.productId);
        if (!row) return null;
        return {
          productId: item.productId,
          name: row.name as string,
          slug: row.slug as string,
          brand: (row.brand as string | null) ?? null,
          category: (row.category as string | null) ?? null,
          imageUrl: (row.image_url as string | null) ?? null,
          addedAt: item.addedAt,
        } satisfies SavedRecommendation;
      })
      .filter((r): r is SavedRecommendation => r !== null);
  } catch (err) {
    logger.warn('recommendation-feedback: saved list failed', { error: String(err) });
    return [];
  }
}
