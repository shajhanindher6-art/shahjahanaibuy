/**
 * User tracking dashboard — one joined view over data that already
 * existed in three separate places.
 *
 * Before this, a user had to visit three places to answer "what am I
 * tracking, and did anything drop?": /dashboard/wishlists listed only
 * list names and counts (no products, no prices), price alerts could
 * only be created from a product page dialog (no list, no edit, no
 * toggle), and price history lived only on each product page.
 * getUserTracking() joins them server-side in one authenticated call:
 *
 *   - every wishlist item, enriched with its product (the wishlist
 *     items API returns only product_id, so the page used to need a
 *     second lookup per item — or, in practice, showed no product);
 *   - current vs previous price from price_history (latest two rows
 *     per product, regardless of retailer, so the change % matches
 *     what the product page's trend chart shows for the latest move);
 *   - the user's alerts for those products, enriched with the product
 *     name, so alerts can be toggled, retargeted, or deleted here.
 *
 * No new tables are needed: wishlists, wishlist_items, alerts and
 * price_history already exist (migrations 002 + 006). This runs with
 * the authenticated server client, so owner-scoped RLS still applies
 * — a user only ever sees their own lists and alerts.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { getWishlists, getWishlistItems } from './wishlists';
import { getAlerts } from './alerts';

export interface TrackedItem {
  itemId: string;
  wishlistId: string;
  wishlistName: string;
  product: {
    id: string;
    name: string;
    slug: string;
    brand: string | null;
    category: string | null;
    imageUrl: string | null;
  };
  targetPrice: number | null;
  notes: string | null;
  addedAt: string;
  currentPrice: number | null;
  previousPrice: number | null;
  changePct: number | null;
  belowTarget: boolean;
}

export interface TrackedAlert {
  id: string;
  productId: string;
  productName: string;
  productSlug: string | null;
  alertType: string;
  conditionValue: number | null;
  channel: string;
  active: boolean;
  lastTriggeredAt: string | null;
  triggerCount: number;
  createdAt: string;
}

export interface TrackingSummary {
  savedCount: number;
  activeAlerts: number;
  priceDrops: number;
  belowTarget: number;
}

export interface TrackingResult {
  items: TrackedItem[];
  alerts: TrackedAlert[];
  summary: TrackingSummary;
}

export async function getUserTracking(
  supabase: AnySupabaseClient,
  userId: string
): Promise<TrackingResult> {
  const empty: TrackingResult = {
    items: [],
    alerts: [],
    summary: { savedCount: 0, activeAlerts: 0, priceDrops: 0, belowTarget: 0 },
  };
  try {
    const [wishlists, alerts] = await Promise.all([
      getWishlists(supabase, userId),
      getAlerts(supabase, userId),
    ]);

    // All items across all lists, with their list name attached.
    const itemsRaw: Array<{
      itemId: string;
      wishlistId: string;
      wishlistName: string;
      productId: string;
      targetPrice: number | null;
      notes: string | null;
      addedAt: string;
    }> = [];
    for (const wl of wishlists) {
      const items = await getWishlistItems(supabase, wl.id, userId);
      for (const item of items) {
        itemsRaw.push({
          itemId: item.id,
          wishlistId: wl.id,
          wishlistName: wl.name,
          productId: item.productId,
          targetPrice: item.targetPrice,
          notes: item.notes,
          addedAt: item.addedAt,
        });
      }
    }

    const productIds = Array.from(new Set(itemsRaw.map((i) => i.productId)));
    const alertProductIds = Array.from(new Set(alerts.map((a) => a.productId)));
    const allProductIds = Array.from(new Set([...productIds, ...alertProductIds]));

    const productById = new Map<string, TrackedItem['product']>();
    if (allProductIds.length > 0) {
      const { data: products } = await supabase
        .from('products')
        .select('id, name, slug, brand, category, image_url')
        .in('id', allProductIds);
      for (const p of (products ?? []) as Array<Record<string, unknown>>) {
        productById.set(p.id as string, {
          id: p.id as string,
          name: p.name as string,
          slug: p.slug as string,
          brand: (p.brand as string | null) ?? null,
          category: (p.category as string | null) ?? null,
          imageUrl: (p.image_url as string | null) ?? null,
        });
      }
    }

    // Latest two price_history rows per product (newest first).
    const pricesByProduct = new Map<string, number[]>();
    if (productIds.length > 0) {
      const { data: history } = await supabase
        .from('price_history')
        .select('product_id, price, recorded_at')
        .in('product_id', productIds)
        .order('recorded_at', { ascending: false })
        .limit(500);
      for (const row of (history ?? []) as Array<{ product_id: string; price: number | string }>) {
        const list = pricesByProduct.get(row.product_id) ?? [];
        if (list.length < 2) list.push(parseFloat(String(row.price)));
        pricesByProduct.set(row.product_id, list);
      }
    }

    const items: TrackedItem[] = [];
    for (const raw of itemsRaw) {
      const product = productById.get(raw.productId);
      if (!product) continue; // Product deleted or unreadable — skip, don't break the page.
      const prices = pricesByProduct.get(raw.productId) ?? [];
      const currentPrice = prices[0] ?? null;
      const previousPrice = prices[1] ?? null;
      const changePct =
        currentPrice !== null && previousPrice !== null && previousPrice !== 0
          ? ((currentPrice - previousPrice) / previousPrice) * 100
          : null;
      items.push({
        itemId: raw.itemId,
        wishlistId: raw.wishlistId,
        wishlistName: raw.wishlistName,
        product,
        targetPrice: raw.targetPrice,
        notes: raw.notes,
        addedAt: raw.addedAt,
        currentPrice,
        previousPrice,
        changePct,
        belowTarget: raw.targetPrice !== null && currentPrice !== null && currentPrice <= raw.targetPrice,
      });
    }

    const trackedAlerts: TrackedAlert[] = alerts.map((a) => {
      const product = productById.get(a.productId);
      return {
        id: a.id,
        productId: a.productId,
        productName: product?.name ?? 'Unknown product',
        productSlug: product?.slug ?? null,
        alertType: a.alertType,
        conditionValue: a.conditionValue,
        channel: a.channel,
        active: a.active,
        lastTriggeredAt: a.lastTriggeredAt,
        triggerCount: a.triggerCount,
        createdAt: a.createdAt,
      };
    });

    return {
      items,
      alerts: trackedAlerts,
      summary: {
        savedCount: items.length,
        activeAlerts: trackedAlerts.filter((a) => a.active).length,
        priceDrops: items.filter((i) => (i.changePct ?? 0) < 0).length,
        belowTarget: items.filter((i) => i.belowTarget).length,
      },
    };
  } catch (err) {
    logger.error('getUserTracking: unexpected error', { error: String(err) });
    return empty;
  }
}
