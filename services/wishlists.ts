/**
 * Wishlists data access service.
 * Reads from and writes to the `wishlists` and `wishlist_items` tables
 * (migration 006).
 *
 * All functions accept an `AnySupabaseClient` so they work with both the
 * browser (anon, RLS-enforced) and server (service role) clients.
 *
 * Ownership is verified server-side for every update/delete operation by
 * checking that the wishlist's `user_id` matches the provided `userId`.
 *
 * Database snake_case columns are mapped to camelCase TypeScript properties.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import type { Wishlist, WishlistItem } from '@/types/catalog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateWishlistInput {
  name: string;
  description?: string;
  isPublic?: boolean;
}

export interface UpdateWishlistInput {
  name?: string;
  description?: string;
  isPublic?: boolean;
}

export interface AddWishlistItemInput {
  notes?: string;
  targetPrice?: number;
}

// ---------------------------------------------------------------------------
// Row → domain mappers
// ---------------------------------------------------------------------------

interface WishlistRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  is_public: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function mapWishlist(row: WishlistRow): Wishlist {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    isPublic: row.is_public,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface WishlistItemRow {
  id: string;
  wishlist_id: string;
  product_id: string;
  notes: string | null;
  target_price: number | string | null;
  sort_order: number;
  added_at: string;
}

function mapWishlistItem(row: WishlistItemRow): WishlistItem {
  return {
    id: row.id,
    wishlistId: row.wishlist_id,
    productId: row.product_id,
    notes: row.notes,
    targetPrice: row.target_price !== null ? parseFloat(String(row.target_price)) : null,
    sortOrder: row.sort_order,
    addedAt: row.added_at,
  };
}

// ---------------------------------------------------------------------------
// Wishlist CRUD
// ---------------------------------------------------------------------------

/**
 * List all wishlists belonging to a user, ordered by sort order then name.
 */
export async function getWishlists(
  supabase: AnySupabaseClient,
  userId: string
): Promise<Wishlist[]> {
  try {
    const { data, error } = await supabase
      .from('wishlists')
      .select('id, user_id, name, description, is_public, sort_order, created_at, updated_at')
      .eq('user_id', userId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error || !data) {
      if (error) logger.warn('getWishlists: query failed', { error: error.message });
      return [];
    }

    return data.map((row) => mapWishlist(row as WishlistRow));
  } catch (err) {
    logger.error('getWishlists: unexpected error', { error: String(err) });
    return [];
  }
}

/**
 * Create a new wishlist for a user.
 * @returns The created wishlist, or `null` on failure.
 */
export async function createWishlist(
  supabase: AnySupabaseClient,
  userId: string,
  data: CreateWishlistInput
): Promise<Wishlist | null> {
  try {
    const { data: inserted, error } = await supabase
      .from('wishlists')
      .insert({
        user_id: userId,
        name: data.name,
        description: data.description ?? null,
        is_public: data.isPublic ?? false,
      })
      .select('id, user_id, name, description, is_public, sort_order, created_at, updated_at')
      .maybeSingle();

    if (error || !inserted) {
      if (error) logger.warn('createWishlist: insert failed', { error: error.message });
      return null;
    }

    return mapWishlist(inserted as WishlistRow);
  } catch (err) {
    logger.error('createWishlist: unexpected error', { error: String(err) });
    return null;
  }
}

/**
 * Update a wishlist. Verifies that the wishlist belongs to `userId` before
 * updating.
 *
 * @returns The updated wishlist, or `null` if not found / not owned / on error.
 */
export async function updateWishlist(
  supabase: AnySupabaseClient,
  wishlistId: string,
  userId: string,
  data: UpdateWishlistInput
): Promise<Wishlist | null> {
  try {
    // Verify ownership first
    const { data: existing, error: fetchError } = await supabase
      .from('wishlists')
      .select('user_id')
      .eq('id', wishlistId)
      .maybeSingle();

    if (fetchError || !existing) {
      if (fetchError) logger.warn('updateWishlist: ownership check failed', { error: fetchError.message });
      return null;
    }

    if (existing.user_id !== userId) {
      logger.warn('updateWishlist: user does not own wishlist', { wishlistId, userId });
      return null;
    }

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.isPublic !== undefined) updateData.is_public = data.isPublic;

    if (Object.keys(updateData).length === 0) {
      // Nothing to update — return the existing record
      const { data: current } = await supabase
        .from('wishlists')
        .select('id, user_id, name, description, is_public, sort_order, created_at, updated_at')
        .eq('id', wishlistId)
        .maybeSingle();
      return current ? mapWishlist(current as WishlistRow) : null;
    }

    const { data: updated, error } = await supabase
      .from('wishlists')
      .update(updateData)
      .eq('id', wishlistId)
      .select('id, user_id, name, description, is_public, sort_order, created_at, updated_at')
      .maybeSingle();

    if (error || !updated) {
      if (error) logger.warn('updateWishlist: update failed', { error: error.message });
      return null;
    }

    return mapWishlist(updated as WishlistRow);
  } catch (err) {
    logger.error('updateWishlist: unexpected error', { error: String(err) });
    return null;
  }
}

/**
 * Delete a wishlist. Verifies ownership before deleting.
 * @returns `true` on success, `false` if not found / not owned / on error.
 */
export async function deleteWishlist(
  supabase: AnySupabaseClient,
  wishlistId: string,
  userId: string
): Promise<boolean> {
  try {
    // Verify ownership
    const { data: existing, error: fetchError } = await supabase
      .from('wishlists')
      .select('user_id')
      .eq('id', wishlistId)
      .maybeSingle();

    if (fetchError || !existing) {
      if (fetchError) logger.warn('deleteWishlist: ownership check failed', { error: fetchError.message });
      return false;
    }

    if (existing.user_id !== userId) {
      logger.warn('deleteWishlist: user does not own wishlist', { wishlistId, userId });
      return false;
    }

    const { error } = await supabase
      .from('wishlists')
      .delete()
      .eq('id', wishlistId);

    if (error) {
      logger.warn('deleteWishlist: delete failed', { error: error.message });
      return false;
    }

    return true;
  } catch (err) {
    logger.error('deleteWishlist: unexpected error', { error: String(err) });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Wishlist items
// ---------------------------------------------------------------------------

/**
 * List items in a wishlist. Verifies that the wishlist belongs to `userId`.
 * Returns an empty array if not owned or on error.
 */
export async function getWishlistItems(
  supabase: AnySupabaseClient,
  wishlistId: string,
  userId: string
): Promise<WishlistItem[]> {
  try {
    // Verify ownership
    const { data: existing, error: fetchError } = await supabase
      .from('wishlists')
      .select('user_id')
      .eq('id', wishlistId)
      .maybeSingle();

    if (fetchError || !existing) {
      if (fetchError) logger.warn('getWishlistItems: ownership check failed', { error: fetchError.message });
      return [];
    }

    if (existing.user_id !== userId) {
      logger.warn('getWishlistItems: user does not own wishlist', { wishlistId, userId });
      return [];
    }

    const { data, error } = await supabase
      .from('wishlist_items')
      .select('id, wishlist_id, product_id, notes, target_price, sort_order, added_at')
      .eq('wishlist_id', wishlistId)
      .order('sort_order', { ascending: true })
      .order('added_at', { ascending: false });

    if (error || !data) {
      if (error) logger.warn('getWishlistItems: query failed', { error: error.message });
      return [];
    }

    return data.map((row) => mapWishlistItem(row as WishlistItemRow));
  } catch (err) {
    logger.error('getWishlistItems: unexpected error', { error: String(err) });
    return [];
  }
}

/**
 * Add a product to a wishlist. Verifies wishlist ownership before inserting.
 *
 * @param data Optional `{ notes, targetPrice }` for the wishlist item.
 * @returns The created wishlist item, or `null` on failure.
 */
export async function addWishlistItem(
  supabase: AnySupabaseClient,
  wishlistId: string,
  userId: string,
  productId: string,
  data: AddWishlistItemInput = {}
): Promise<WishlistItem | null> {
  try {
    // Verify ownership
    const { data: existing, error: fetchError } = await supabase
      .from('wishlists')
      .select('user_id')
      .eq('id', wishlistId)
      .maybeSingle();

    if (fetchError || !existing) {
      if (fetchError) logger.warn('addWishlistItem: ownership check failed', { error: fetchError.message });
      return null;
    }

    if (existing.user_id !== userId) {
      logger.warn('addWishlistItem: user does not own wishlist', { wishlistId, userId });
      return null;
    }

    const { data: inserted, error } = await supabase
      .from('wishlist_items')
      .insert({
        wishlist_id: wishlistId,
        product_id: productId,
        notes: data.notes ?? null,
        target_price: data.targetPrice ?? null,
      })
      .select('id, wishlist_id, product_id, notes, target_price, sort_order, added_at')
      .maybeSingle();

    if (error || !inserted) {
      if (error) logger.warn('addWishlistItem: insert failed', { error: error.message });
      return null;
    }

    return mapWishlistItem(inserted as WishlistItemRow);
  } catch (err) {
    logger.error('addWishlistItem: unexpected error', { error: String(err) });
    return null;
  }
}

/**
 * Remove an item from a wishlist. Verifies that the item's wishlist belongs
 * to `userId` before deleting.
 * @returns `true` on success, `false` if not found / not owned / on error.
 */
export async function removeWishlistItem(
  supabase: AnySupabaseClient,
  itemId: string,
  userId: string
): Promise<boolean> {
  try {
    // Fetch the item and its wishlist's user_id to verify ownership
    const { data: item, error: fetchError } = await supabase
      .from('wishlist_items')
      .select('wishlists(user_id)')
      .eq('id', itemId)
      .maybeSingle();

    if (fetchError || !item) {
      if (fetchError) logger.warn('removeWishlistItem: ownership check failed', { error: fetchError.message });
      return false;
    }

    const wishlistOwner = (item as { wishlists: { user_id: string } | { user_id: string }[] | null }).wishlists;
    if (!wishlistOwner) {
      logger.warn('removeWishlistItem: wishlist not found', { itemId });
      return false;
    }
    const ownerId = Array.isArray(wishlistOwner) ? wishlistOwner[0]?.user_id : wishlistOwner.user_id;
    if (!ownerId || ownerId !== userId) {
      logger.warn('removeWishlistItem: user does not own wishlist item', { itemId, userId });
      return false;
    }

    const { error } = await supabase
      .from('wishlist_items')
      .delete()
      .eq('id', itemId);

    if (error) {
      logger.warn('removeWishlistItem: delete failed', { error: error.message });
      return false;
    }

    return true;
  } catch (err) {
    logger.error('removeWishlistItem: unexpected error', { error: String(err) });
    return false;
  }
}
