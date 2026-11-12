/**
 * Price alert checker.
 *
 * This is the missing link in the price alerts feature. Until now alerts
 * could be created (product page dialog + /api/v1/alerts) and notifications
 * could be dispatched (notification queue + email/push), but nothing ever
 * compared an active alert against the current price, so an alert could
 * never fire.
 *
 * checkPriceAlerts() is designed to run on a schedule (see
 * app/api/v1/alerts/check/route.ts, protected by CRON_SECRET) with a
 * service-role Supabase client, because it must read alerts belonging
 * to every user — the owner-scoped RLS policies on `alerts` would hide
 * other users' alerts from an anon/authenticated client.
 *
 * Trigger rules:
 * - price_drop:    current price <= alert.condition_value (target price)
 * - back_in_stock: product is in stock now
 * - deal:          an active, not-yet-expired deal exists for the product
 *
 * Duplicate prevention: an alert fires at most once per distinct
 * triggered price. If the price stays at the same level, the checker
 * skips it (checked via price_alert_history); if it drops further to
 * a new lower price, a new alert fires. On every trigger the alert's
 * last_triggered_at / trigger_count are updated and the trigger is
 * recorded in price_alert_history.
 *
 * The current price is the latest price_history row, falling back to
 * the lowest in-stock merchant_product price when no price history
 * exists yet.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { appConfig } from '@/lib/config/app';
import { queueNotification } from '@/services/notifications';
import { recordAlertTrigger } from '@/services/alert-history';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AlertCheckResult {
  checked: number;
  triggered: number;
  queued: number;
  skippedDuplicate: number;
  failed: number;
}

interface AlertRow {
  id: string;
  user_id: string;
  product_id: string;
  alert_type: string;
  condition_value: number | string | null;
  channel: string;
  active: boolean;
  last_triggered_at: string | null;
  trigger_count: number;
}

interface ProductInfo {
  id: string;
  name: string;
  slug: string;
}

// ---------------------------------------------------------------------------
// Price lookup
// ---------------------------------------------------------------------------

interface CurrentPrice {
  price: number | null;
  availability: string | null;
}

/**
 * Section 18, item 17 — batched current-price lookup, mirroring
 * the guest-alert path (app/api/v1/prices/refresh/route.ts
 * `priceByProduct`): ONE price_history query for every alert
 * product, then ONE merchant_products query for the products with
 * no price history, instead of 1–2 sequential queries per alert
 * (up to ~1000–2000 queries per check run).
 *
 * Latest price_history row wins per product (ordered by
 * recorded_at desc, first row kept); the fallback is the cheapest
 * in-stock merchant listing per product (ordered by price asc,
 * first row kept). A product with neither has no price — never a
 * guessed one.
 */
async function getCurrentPrices(
  supabase: AnySupabaseClient,
  productIds: string[]
): Promise<Map<string, CurrentPrice>> {
  const prices = new Map<string, CurrentPrice>();
  const ids = [...new Set(productIds.filter(Boolean))];
  if (ids.length === 0) return prices;

  const { data: latest } = await supabase
    .from('price_history')
    .select('product_id, price, availability, recorded_at')
    .in('product_id', ids)
    .order('recorded_at', { ascending: false })
    .limit(1000);

  for (const row of (latest ?? []) as Array<{
    product_id: string;
    price: number | string | null;
    availability: string | null;
  }>) {
    if (prices.has(row.product_id)) continue;
    if (row.price === null || row.price === undefined) continue;
    const price = parseFloat(String(row.price));
    if (!Number.isFinite(price)) continue;
    prices.set(row.product_id, {
      price,
      availability: row.availability ?? null,
    });
  }

  // Fallback: lowest in-stock merchant listing, for the products
  // with no usable price history.
  const missing = ids.filter((id) => !prices.has(id));
  if (missing.length === 0) return prices;

  const { data: listings } = await supabase
    .from('merchant_products')
    .select('product_id, price, in_stock')
    .in('product_id', missing)
    .is('deleted_at', null)
    .eq('in_stock', true)
    .order('price', { ascending: true })
    .limit(1000);

  for (const row of (listings ?? []) as Array<{
    product_id: string;
    price: number | string | null;
    in_stock: boolean;
  }>) {
    if (prices.has(row.product_id)) continue;
    if (row.price === null || row.price === undefined) continue;
    const price = parseFloat(String(row.price));
    if (!Number.isFinite(price)) continue;
    prices.set(row.product_id, {
      price,
      availability: row.in_stock ? 'in_stock' : 'out_of_stock',
    });
  }

  return prices;
}

async function hasActiveDeal(
  supabase: AnySupabaseClient,
  productId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('deals')
    .select('id')
    .eq('product_id', productId)
    .eq('active', true)
    .is('deleted_at', null)
    .gte('end_at', new Date().toISOString())
    .limit(1)
    .maybeSingle();

  return Boolean(data);
}

async function alreadyTriggeredAtPrice(
  supabase: AnySupabaseClient,
  alertId: string,
  price: number
): Promise<boolean> {
  const { data } = await supabase
    .from('price_alert_history')
    .select('triggered_price')
    .eq('alert_id', alertId)
    .order('sent_at', { ascending: false })
    .limit(50);

  if (!data) return false;

  return (data as Array<{ triggered_price: number | string }>).some(
    (row) => parseFloat(String(row.triggered_price)) === price
  );
}

// ---------------------------------------------------------------------------
// Checker
// ---------------------------------------------------------------------------

export async function checkPriceAlerts(
  supabase: AnySupabaseClient
): Promise<AlertCheckResult> {
  const result: AlertCheckResult = {
    checked: 0,
    triggered: 0,
    queued: 0,
    skippedDuplicate: 0,
    failed: 0,
  };

  const { data: alerts, error } = await supabase
    .from('alerts')
    .select(
      'id, user_id, product_id, alert_type, condition_value, channel, active, last_triggered_at, trigger_count'
    )
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(1000);

  if (error || !alerts) {
    logger.warn('checkPriceAlerts: failed to load active alerts', {
      error: error?.message,
    });
    return result;
  }

  // Resolve product names/slugs in one query for the notification text.
  const productIds = [...new Set(alerts.map((a) => a.product_id as string))];
  const productMap = new Map<string, ProductInfo>();
  if (productIds.length > 0) {
    const { data: products } = await supabase
      .from('products')
      .select('id, name, slug')
      .in('id', productIds);

    for (const p of (products ?? []) as Array<Record<string, unknown>>) {
      productMap.set(p.id as string, {
        id: p.id as string,
        name: p.name as string,
        slug: p.slug as string,
      });
    }
  }

  // Section 18, item 17: current prices for ALL alert products
  // in two queries total (price_history, then the merchant
  // fallback for products without history) — not one or two
  // queries per alert.
  const priceMap = await getCurrentPrices(supabase, productIds);

  for (const row of alerts as unknown as AlertRow[]) {
    result.checked++;

    try {
      const product = productMap.get(row.product_id);
      if (!product) {
        result.failed++;
        continue;
      }

      const target =
        row.condition_value !== null && row.condition_value !== undefined
          ? parseFloat(String(row.condition_value))
          : null;

      const { price, availability } = priceMap.get(row.product_id) ?? {
        price: null,
        availability: null,
      };

      let shouldTrigger = false;
      let subject = '';
      let body = '';
      const productUrl = `${appConfig.url}/products/${product.slug}`;

      if (row.alert_type === 'price_drop') {
        if (target !== null && price !== null && price <= target) {
          shouldTrigger = true;
          subject = `Price drop alert: ${product.name} is now $${price.toFixed(2)}!`;
          body = `Great news! ${product.name} dropped to $${price.toFixed(2)} (your target was $${target.toFixed(2)}). View it at ${productUrl}`;
        }
      } else if (row.alert_type === 'back_in_stock') {
        if (availability === 'in_stock' && price !== null) {
          shouldTrigger = true;
          subject = `Back in stock: ${product.name}`;
          body = `${product.name} is back in stock at $${price.toFixed(2)}. View it at ${productUrl}`;
        }
      } else if (row.alert_type === 'deal') {
        if (await hasActiveDeal(supabase, row.product_id)) {
          shouldTrigger = true;
          subject = `New deal: ${product.name}`;
          body = `There is a new deal on ${product.name}. View it at ${productUrl}`;
        }
      } else {
        // Unknown alert type — skip rather than fail the whole run.
        logger.warn('checkPriceAlerts: unknown alert type', {
          alertId: row.id,
          alertType: row.alert_type,
        });
        continue;
      }

      if (!shouldTrigger) continue;

      // One notification per distinct triggered price.
      const triggerPrice = price ?? target ?? 0;
      if (await alreadyTriggeredAtPrice(supabase, row.id, triggerPrice)) {
        result.skippedDuplicate++;
        continue;
      }

      const channel =
        row.channel === 'email' || row.channel === 'push' || row.channel === 'both'
          ? row.channel
          : 'email';

      const queued = await queueNotification(
        supabase,
        row.user_id,
        'price_alert',
        channel,
        subject,
        body,
        {
          productName: product.name,
          productSlug: product.slug,
          triggeredPrice: triggerPrice,
          targetPrice: target,
          productUrl,
        }
      );

      if (!queued) {
        result.failed++;
        continue;
      }

      await recordAlertTrigger(
        supabase,
        row.id,
        row.user_id,
        row.product_id,
        triggerPrice,
        target,
        channel
      );

      await supabase
        .from('alerts')
        .update({
          last_triggered_at: new Date().toISOString(),
          trigger_count: (row.trigger_count ?? 0) + 1,
        })
        .eq('id', row.id);

      result.triggered++;
      result.queued++;
    } catch (err) {
      logger.error('checkPriceAlerts: alert failed', {
        alertId: row.id,
        error: String(err),
      });
      result.failed++;
    }
  }

  logger.info('checkPriceAlerts: run finished', { ...result });
  return result;
}
