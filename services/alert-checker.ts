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
 * - back_in_stock: a RECORDED out-of-stock → in-stock transition
 *   (§12 #67 — merely being in stock never fires; transitions come
 *   from availability_history, with the two latest price_history
 *   rows as fallback when that table is unavailable)
 * - deal:          an active, not-yet-expired deal exists for the product
 *   (one batched query for all products — §12 #69, no per-alert N+1)
 * - significant_drop (§12 #61): latest recorded price fell by at
 *   least condition_value % (default 10) vs the previous recorded
 *   price; evidence carries old/new price, % drop, timestamps, and
 *   the Phase 2 deal validation of the drop.
 * - trend (§12 #62): recorded history over the last 30 days trends
 *   down/up by ≥5% with the regression slope agreeing; <5 points
 *   in the window never fires.
 * - opportunity (§12 #64): Phase 2's buying-opportunity composite
 *   qualifies (near recorded low + fresh + validated discount +
 *   in stock) — reused, never re-implemented.
 * - wishlist (§12 #63): not a stored alert type — a second phase
 *   evaluates every wishlist item (target hit / real transition /
 *   significant drop) and queues directly. It creates NO stored
 *   alert rows, so the tier cap is untouched; it honours the
 *   master switches and dedupes by trigger key.
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
import { getFreshnessStatus } from '@/lib/price-freshness';
import { appConfig } from '@/lib/config/app';
import { queueNotification } from '@/services/notifications';
import { recordAlertTrigger } from '@/services/alert-history';
import {
  DEFAULT_ALERT_DELIVERY_SETTINGS,
  getAlertDeliverySettingsByUser,
} from '@/services/settings';
import {
  evaluateSignificantDrop,
  evaluateTrend,
  evaluateOpportunityAlert,
  evaluateWishlistItemTriggers,
  SIGNIFICANT_DROP_THRESHOLD_PCT,
  type WishlistTrigger,
} from '@/services/alert-triggers';
import type { FakeSalePoint } from '@/services/fake-sale';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AlertCheckResult {
  checked: number;
  triggered: number;
  queued: number;
  skippedDuplicate: number;
  /** Alerts that fired but were NOT queued because the user opted out (§12 #65). */
  skippedOptedOut: number;
  failed: number;
  /** Wishlist phase (§12 #63): items evaluated / triggers fired / notifications queued. */
  wishlistChecked: number;
  wishlistTriggered: number;
  wishlistQueued: number;
  /**
   * Section 20, §12 #81 — alerts that WOULD have fired but were
   * suppressed because the triggering price (or back-in-stock
   * transition) is stale: recorded more than STALE_PRICE_DAYS ago.
   * A stale price must never fire an "is now $Y!" alert as if
   * current; suppression is the gate, and this count proves it.
   */
  skippedStale: number;
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
  /** Recorded products.data_freshness — the opportunity composite needs a known check date. */
  dataFreshness: string | null;
}

// ---------------------------------------------------------------------------
// Price lookup
// ---------------------------------------------------------------------------

interface CurrentPrice {
  price: number | null;
  availability: string | null;
  /**
   * Section 20, §12 #81 — recorded_at of the latest price_history
   * row behind this price (null for the merchant-listing fallback,
   * which carries no check date). The checker gates "is now $Y!"
   * triggers on this date: stale (> STALE_PRICE_DAYS) never fires.
   */
  recordedAt: string | null;
}

/**
 * Section 20, §12 #81 — the freshness gate for "is now" alert
 * triggers. Returns 'stale' when the triggering record is older
 * than STALE_PRICE_DAYS, 'unknown' when no check date exists, and
 * 'fresh' otherwise. Callers SUPPRESS stale triggers and QUALIFY
 * unknown-age ones (the price may be out of date) — never present
 * either as a current price.
 */
export function alertPriceFreshness(
  recordedAt: string | null | undefined,
  now: Date = new Date()
): 'fresh' | 'stale' | 'unknown' {
  return getFreshnessStatus(recordedAt, now).status;
}

/** Staleness note appended to a trigger body whose price age is unknown. */
export function alertUnknownAgeNote(): string {
  return ' Price age unknown — this price was not recorded with a check date, so it may be out of date.';
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
    recorded_at: string | null;
  }>) {
    if (prices.has(row.product_id)) continue;
    if (row.price === null || row.price === undefined) continue;
    const price = parseFloat(String(row.price));
    if (!Number.isFinite(price)) continue;
    prices.set(row.product_id, {
      price,
      availability: row.availability ?? null,
      recordedAt: row.recorded_at ?? null,
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
      // Merchant-listing fallback: no recorded check date exists
      // for this price, so its age is unknown (§12 #81).
      recordedAt: null,
    });
  }

  return prices;
}

/**
 * Section 19, Phase 6 (§12 #69) — batched active-deal check.
 * ONE query for the whole product set (`.in('product_id', ids)`),
 * mirroring the refresh route's `dealProductIds` set. The old
 * per-alert `hasActiveDeal(supabase, productId)` issued one query
 * per `deal` alert (N queries for N alerts); every caller now
 * reads this set instead.
 */
export async function getActiveDealProductIds(
  supabase: AnySupabaseClient,
  productIds: string[]
): Promise<Set<string>> {
  const ids = [...new Set(productIds.filter(Boolean))];
  const out = new Set<string>();
  if (ids.length === 0) return out;

  const { data } = await supabase
    .from('deals')
    .select('product_id')
    .in('product_id', ids)
    .eq('active', true)
    .is('deleted_at', null)
    .gte('end_at', new Date().toISOString());

  for (const row of (data ?? []) as Array<{ product_id: string }>) {
    if (row.product_id) out.add(row.product_id);
  }
  return out;
}

/** One recorded price point, newest-first order in the map values. */
export interface HistoryPoint extends FakeSalePoint {
  availability: string | null;
}

/**
 * Batched recorded price history for a product set: ONE
 * price_history query, grouped by product (newest first, up to
 * 100 points kept per product). Products with no history are
 * absent from the map — never a guessed series.
 */
export async function getPriceHistories(
  supabase: AnySupabaseClient,
  productIds: string[]
): Promise<Map<string, HistoryPoint[]>> {
  const ids = [...new Set(productIds.filter(Boolean))];
  const out = new Map<string, HistoryPoint[]>();
  if (ids.length === 0) return out;

  const { data } = await supabase
    .from('price_history')
    .select('product_id, price, availability, recorded_at')
    .in('product_id', ids)
    .order('recorded_at', { ascending: false })
    .limit(2000);

  for (const row of (data ?? []) as Array<{
    product_id: string;
    price: number | string | null;
    availability: string | null;
    recorded_at: string;
  }>) {
    if (row.price === null || row.price === undefined) continue;
    const price = parseFloat(String(row.price));
    if (!Number.isFinite(price)) continue;
    const list = out.get(row.product_id) ?? [];
    if (list.length >= 100) continue;
    list.push({
      price,
      recordedAt: row.recorded_at,
      availability: row.availability ?? null,
    });
    out.set(row.product_id, list);
  }
  return out;
}

export interface AvailabilityTransition {
  /** True only when the recorded availability changed out → in. */
  transition: boolean;
  /** recorded_at of the latest snapshot, when a transition was recorded. */
  transitionAt: string | null;
}

/**
 * Section 19, Phase 6 (§12 #67) — batched out→in transition
 * lookup for the signed-in checker.
 *
 * Primary source: availability_history (written by the refresh
 * step only when the snapshot actually changes). A product
 * transitions when its latest row is in_stock and the previous
 * row is not. One row (or none) can never prove a transition —
 * the previous state is unknown, so no alert fires.
 *
 * Fallback: when availability_history is unavailable (migration
 * 026 not applied) or holds no rows for a product, the two
 * latest price_history rows for that product are compared the
 * same way. The fallback never invents a transition either: it
 * needs two real rows with different availability.
 */
export async function getAvailabilityTransitions(
  supabase: AnySupabaseClient,
  productIds: string[],
  historyByProduct: Map<string, HistoryPoint[]>
): Promise<Map<string, AvailabilityTransition>> {
  const ids = [...new Set(productIds.filter(Boolean))];
  const out = new Map<string, AvailabilityTransition>();
  if (ids.length === 0) return out;

  const fromHistoryPairs = (productId: string): AvailabilityTransition => {
    const points = historyByProduct.get(productId) ?? [];
    if (points.length < 2) return { transition: false, transitionAt: null };
    const [latest, previous] = points;
    const transition =
      latest.availability === 'in_stock' && previous.availability !== 'in_stock';
    return {
      transition,
      transitionAt: transition ? latest.recordedAt : null,
    };
  };

  let availabilityRows: Array<{
    product_id: string;
    in_stock: boolean;
    recorded_at: string;
  }> | null = null;
  try {
    const { data, error } = await supabase
      .from('availability_history')
      .select('product_id, in_stock, recorded_at')
      .in('product_id', ids)
      .order('recorded_at', { ascending: false })
      .limit(1000);
    if (!error) {
      availabilityRows = (data ?? []) as Array<{
        product_id: string;
        in_stock: boolean;
        recorded_at: string;
      }>;
    }
  } catch {
    availabilityRows = null;
  }

  // Table unavailable → every product falls back to history pairs.
  if (availabilityRows === null) {
    for (const id of ids) out.set(id, fromHistoryPairs(id));
    return out;
  }

  const latestTwo = new Map<string, Array<{ in_stock: boolean; recorded_at: string }>>();
  for (const row of availabilityRows) {
    const list = latestTwo.get(row.product_id) ?? [];
    if (list.length >= 2) continue;
    list.push({ in_stock: row.in_stock === true, recorded_at: row.recorded_at });
    latestTwo.set(row.product_id, list);
  }

  for (const id of ids) {
    const rows = latestTwo.get(id) ?? [];
    if (rows.length < 2) {
      // Too little availability history to prove a transition —
      // fall back to the price_history pair for this product.
      out.set(id, fromHistoryPairs(id));
      continue;
    }
    const [latest, previous] = rows;
    const transition = latest.in_stock === true && previous.in_stock === false;
    out.set(id, {
      transition,
      transitionAt: transition ? latest.recorded_at : null,
    });
  }
  return out;
}

/** One wishlist item, as the checker phase reads it (service role). */
interface WishlistCheckItem {
  userId: string;
  productId: string;
  targetPrice: number | null;
}

/**
 * Load every wishlist item (all users) for the wishlist phase
 * (§12 #63). One query; a missing table or read error yields []
 * so the alert loop still runs — the wishlist phase is additive,
 * never fatal to the run.
 */
async function loadWishlistCheckItems(
  supabase: AnySupabaseClient
): Promise<WishlistCheckItem[]> {
  try {
    const { data, error } = await supabase
      .from('wishlist_items')
      .select('product_id, target_price, wishlists(user_id)')
      .order('added_at', { ascending: false })
      .limit(500);

    if (error || !data) {
      if (error) logger.warn('checkPriceAlerts: wishlist items unavailable', { error: error.message });
      return [];
    }

    const items: WishlistCheckItem[] = [];
    for (const row of data as Array<{
      product_id: string;
      target_price: number | string | null;
      wishlists: { user_id: string } | Array<{ user_id: string }> | null;
    }>) {
      const owner = row.wishlists;
      const userId = Array.isArray(owner) ? owner[0]?.user_id : owner?.user_id;
      if (!userId || !row.product_id) continue;
      items.push({
        userId,
        productId: row.product_id,
        targetPrice:
          row.target_price !== null && row.target_price !== undefined
            ? parseFloat(String(row.target_price))
            : null,
      });
    }
    return items;
  } catch (err) {
    logger.warn('checkPriceAlerts: wishlist items load failed', { error: String(err) });
    return [];
  }
}

/**
 * Already-queued wishlist trigger keys for a user set, in ONE
 * notification_queue query (dedupes §12 #63 without a
 * price_alert_history row — wishlist alerts have no alert row,
 * and that table's alert_id is NOT NULL). A trigger key already
 * in the queue (pending or sent — the queue keeps sent rows)
 * never queues twice.
 */
async function loadQueuedWishlistTriggerKeys(
  supabase: AnySupabaseClient,
  userIds: string[]
): Promise<Set<string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  const out = new Set<string>();
  if (ids.length === 0) return out;

  try {
    const { data, error } = await supabase
      .from('notification_queue')
      .select('user_id, type, data, created_at')
      .eq('type', 'price_alert')
      .in('user_id', ids)
      .order('created_at', { ascending: false })
      .limit(500);

    if (error || !data) return out;
    for (const row of data as Array<{
      user_id: string;
      data: Record<string, unknown> | null;
    }>) {
      const key = row.data?.triggerKey;
      if (typeof key === 'string' && key) out.add(`${row.user_id}|${key}`);
    }
  } catch {
    // Dedupe read failed → fail open (a duplicate queue is
    // better than dropping an alert the user asked for).
  }
  return out;
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
    skippedOptedOut: 0,
    failed: 0,
    wishlistChecked: 0,
    wishlistTriggered: 0,
    wishlistQueued: 0,
    skippedStale: 0,
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

  // Section 19, Phase 6 (§12 #63): the wishlist phase reads the
  // same product/price/history/settings data as the alert loop,
  // so wishlist items are loaded BEFORE those batched fetches and
  // their product/user ids join the unions below.
  const wishlistItems = await loadWishlistCheckItems(supabase);

  // Resolve product names/slugs in one query for the notification text.
  const productIds = [
    ...new Set([
      ...alerts.map((a) => a.product_id as string),
      ...wishlistItems.map((w) => w.productId),
    ]),
  ];
  const productMap = new Map<string, ProductInfo>();
  if (productIds.length > 0) {
    const { data: products } = await supabase
      .from('products')
      .select('id, name, slug, data_freshness')
      .in('id', productIds);

    for (const p of (products ?? []) as Array<Record<string, unknown>>) {
      productMap.set(p.id as string, {
        id: p.id as string,
        name: p.name as string,
        slug: p.slug as string,
        dataFreshness: (p.data_freshness as string | null) ?? null,
      });
    }
  }

  // Section 18, item 17: current prices for ALL alert products
  // in two queries total (price_history, then the merchant
  // fallback for products without history) — not one or two
  // queries per alert.
  const priceMap = await getCurrentPrices(supabase, productIds);

  // Section 19, Phase 6: recorded history is needed by the
  // significant_drop / trend / opportunity branches, the
  // wishlist phase — and the transition fallback (§12 #67),
  // which compares the two latest price_history rows when
  // availability_history has too little data. One batched
  // query, never one per alert.
  const needsTransitions =
    (alerts as Array<{ alert_type: string }>).some((a) => a.alert_type === 'back_in_stock') ||
    wishlistItems.length > 0;
  const needsHistory =
    (alerts as Array<{ alert_type: string }>).some((a) =>
      ['significant_drop', 'trend', 'opportunity'].includes(a.alert_type)
    ) || wishlistItems.length > 0 || needsTransitions;
  const historyByProduct = needsHistory
    ? await getPriceHistories(supabase, productIds)
    : new Map<string, HistoryPoint[]>();

  // Section 19, Phase 6 (§12 #69): ONE deals query for the whole
  // set, read by every `deal` alert from the set.
  const needsDeals = (alerts as Array<{ alert_type: string }>).some(
    (a) => a.alert_type === 'deal'
  );
  const dealProductIds = needsDeals
    ? await getActiveDealProductIds(supabase, productIds)
    : new Set<string>();

  // Section 19, Phase 6 (§12 #67): ONE transition lookup for the
  // whole set, read by every `back_in_stock` alert and every
  // wishlist item from the map.
  const transitionsByProduct = needsTransitions
    ? await getAvailabilityTransitions(supabase, productIds, historyByProduct)
    : new Map<string, AvailabilityTransition>();

  // Section 19, Phase 0 (§12 #65): the notification master
  // switches for ALL alert owners in one query (same batching
  // pattern as the prices above). Users with no settings row get
  // the defaults (all on) — only an explicit `false` opts out.
  // Wishlist owners join the union: the wishlist phase honours
  // the same switches.
  const settingsByUser = await getAlertDeliverySettingsByUser(
    supabase,
    [
      ...alerts.map((a) => a.user_id as string),
      ...wishlistItems.map((w) => w.userId),
    ]
  );

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

      const { price, availability, recordedAt } = priceMap.get(row.product_id) ?? {
        price: null,
        availability: null,
        recordedAt: null,
      };

      let shouldTrigger = false;
      let subject = '';
      let body = '';
      /**
       * Section 20, §12 #81 — the check date behind THIS trigger,
       * for the stale gate below. `undefined` = this alert type
       * makes no "is now" claim and is not gated (deal, trend,
       * opportunity); null = a gated trigger with unknown age
       * (qualify, don't suppress); a date = gate on its age.
       */
      let gateRecordedAt: string | null | undefined;
      // Evidence for the queued notification. New alert types
      // must NOT pass their condition_value as `targetPrice` —
      // for significant_drop that value is a % threshold, and
      // the email renderer prints targetPrice as dollars.
      let queueTargetPrice: number | null = target;
      let queueExtra: Record<string, unknown> = {};
      const productUrl = `${appConfig.url}/products/${product.slug}`;

      if (row.alert_type === 'price_drop') {
        if (target !== null && price !== null && price <= target) {
          shouldTrigger = true;
          gateRecordedAt = recordedAt;
          subject = `Price drop alert: ${product.name} is now $${price.toFixed(2)}!`;
          body = `Great news! ${product.name} dropped to $${price.toFixed(2)} (your target was $${target.toFixed(2)}). View it at ${productUrl}`;
        }
      } else if (row.alert_type === 'back_in_stock') {
        // §12 #67: only a RECORDED out→in transition fires.
        // Availability "in_stock" right now, with no transition
        // behind it, is not an event — the product may never
        // have left stock. The price is optional in the body:
        // a real transition with no recorded price still counts.
        const transition = transitionsByProduct.get(row.product_id);
        if (transition?.transition) {
          shouldTrigger = true;
          gateRecordedAt = transition.transitionAt;
          queueExtra = {
            alertType: 'back_in_stock',
            transitionAt: transition.transitionAt,
          };
          subject = `Back in stock: ${product.name}`;
          body =
            `${product.name} is back in stock` +
            (price !== null ? ` at $${price.toFixed(2)}` : '') +
            `. View it at ${productUrl}`;
        }
      } else if (row.alert_type === 'deal') {
        // §12 #69: read from the batched set — no query here.
        if (dealProductIds.has(row.product_id)) {
          shouldTrigger = true;
          subject = `New deal: ${product.name}`;
          body = `There is a new deal on ${product.name}. View it at ${productUrl}`;
        }
      } else if (row.alert_type === 'significant_drop') {
        // §12 #61: condition_value is the drop-% threshold
        // (default 10). Evidence: old/new price, % drop,
        // recorded timestamps, Phase 2 validation of the drop.
        const threshold =
          target !== null && Number.isFinite(target) && target > 0 && target <= 90
            ? target
            : SIGNIFICANT_DROP_THRESHOLD_PCT;
        const history = historyByProduct.get(row.product_id) ?? [];
        const drop = evaluateSignificantDrop(history, threshold);
        if (drop.fires && drop.newPrice !== null && drop.oldPrice !== null) {
          shouldTrigger = true;
          gateRecordedAt = drop.newRecordedAt;
          queueTargetPrice = null;
          queueExtra = {
            alertType: 'significant_drop',
            oldPrice: drop.oldPrice,
            newPrice: drop.newPrice,
            dropPct: drop.dropPct,
            dropValidation: drop.validation?.status ?? null,
            evidence: drop.reason,
          };
          subject = `Price dropped ${drop.dropPct}%: ${product.name} is now $${drop.newPrice.toFixed(2)}!`;
          body =
            `${product.name} fell ${drop.dropPct}% — from $${drop.oldPrice.toFixed(2)} ` +
            `(recorded ${drop.oldRecordedAt}) to $${drop.newPrice.toFixed(2)} (recorded ${drop.newRecordedAt}). ` +
            `${drop.validation ? drop.validation.reason : ''} View it at ${productUrl}`;
        }
      } else if (row.alert_type === 'trend') {
        // §12 #62: sustained move over the recorded 30-day
        // window. Thin history (<5 points) never fires — the
        // evaluator says so, and the body states the point count.
        const history = historyByProduct.get(row.product_id) ?? [];
        const trend = evaluateTrend(history);
        if (trend.fires && trend.endPrice !== null) {
          const direction = trend.direction === 'down' ? 'falling' : 'rising';
          shouldTrigger = true;
          queueTargetPrice = null;
          queueExtra = {
            alertType: 'trend',
            trendDirection: trend.direction,
            changePct: trend.changePct,
            trendPoints: trend.points,
            evidence: trend.reason,
          };
          subject = `Price trend: ${product.name} is ${direction} (${trend.changePct}%)`;
          body =
            `${product.name} is trending ${direction}: ${trend.changePct}% over the last ${trend.windowDays} days ` +
            `(${trend.points} recorded prices, ${trend.startPrice !== null ? `$${trend.startPrice.toFixed(2)}` : 'no start price'} → $${trend.endPrice.toFixed(2)}). ` +
            `This is a recorded trend, not a forecast — the price can move either way. View it at ${productUrl}`;
          // Section 20, §12 #81 — a trend whose latest price is
          // stale is history, not news: qualify it in the body.
          const trendFreshness = getFreshnessStatus(trend.endRecordedAt);
          if (trendFreshness.status === 'stale') {
            body += ` Note: the latest price behind this trend was recorded ${trendFreshness.ageDays} day${trendFreshness.ageDays === 1 ? '' : 's'} ago — it may be out of date.`;
          } else if (trendFreshness.status === 'unknown') {
            body += alertUnknownAgeNote();
          }
        }
      } else if (row.alert_type === 'opportunity') {
        // §12 #64: the Phase 2 composite, reused — fires only
        // when near the recorded low + fresh + validated
        // discount + in stock all hold.
        const history = historyByProduct.get(row.product_id) ?? [];
        const lowest =
          history.length > 0 ? Math.min(...history.map((p) => p.price)) : null;
        const opportunity = evaluateOpportunityAlert({
          currentPrice: price,
          lowestPrice: lowest,
          dataFreshness: product.dataFreshness,
          history,
          inStock: availability === 'in_stock',
        });
        if (opportunity.fires && opportunity.evidence) {
          shouldTrigger = true;
          queueTargetPrice = null;
          queueExtra = {
            alertType: 'opportunity',
            evidence: opportunity.evidence,
          };
          subject = `Good time to buy: ${product.name}`;
          body =
            `${product.name} looks like a good buying opportunity: ${opportunity.evidence} ` +
            `This is based on recorded prices, not a guarantee. View it at ${productUrl}`;
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

      // Section 20, §12 #81 — stale gate for "is now" triggers.
      // price_drop / back_in_stock / significant_drop announce a
      // CURRENT event, so a triggering record older than
      // STALE_PRICE_DAYS (7) suppresses the alert entirely — it is
      // counted in skippedStale, never queued, never recorded as a
      // trigger. An unknown age does not suppress (the price may be
      // fresh) but the body is qualified so it never reads as a
      // confirmed current price. trend / opportunity / deal make no
      // "is now" claim (opportunity already requires fresh; trend
      // carries its own recorded timestamps, qualified below), so
      // they are not gated here. NOTE: there is no 'price_below'
      // alert type in this checker — price_drop is the only
      // target-price trigger, and it is gated above.
      if (gateRecordedAt !== undefined) {
        const freshness = alertPriceFreshness(gateRecordedAt);
        if (freshness === 'stale') {
          result.skippedStale++;
          continue;
        }
        if (freshness === 'unknown') {
          body += alertUnknownAgeNote();
        }
      }

      // Section 19, Phase 0 (§12 #65): honour the master switch
      // BEFORE queueing — an opted-out user gets no queued alert,
      // no trigger record, and no last_triggered_at update. The
      // channel switches are applied below, next to the channel
      // computation (a 'both' alert degrades to the enabled leg).
      const alertSettings =
        settingsByUser.get(row.user_id) ?? DEFAULT_ALERT_DELIVERY_SETTINGS;
      if (!alertSettings.priceAlerts) {
        result.skippedOptedOut++;
        continue;
      }

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

      // Section 19, Phase 0 (§12 #65): the channel switches. A
      // single-channel alert whose channel is off is skipped; a
      // 'both' alert degrades to the one enabled leg instead of
      // being dropped or sent on a disabled channel.
      let effectiveChannel = channel;
      if (channel === 'email' && !alertSettings.emailNotifications) {
        result.skippedOptedOut++;
        continue;
      }
      if (channel === 'push' && !alertSettings.pushNotifications) {
        result.skippedOptedOut++;
        continue;
      }
      if (channel === 'both') {
        if (!alertSettings.emailNotifications && !alertSettings.pushNotifications) {
          result.skippedOptedOut++;
          continue;
        }
        if (!alertSettings.emailNotifications) effectiveChannel = 'push';
        else if (!alertSettings.pushNotifications) effectiveChannel = 'email';
      }

      const queued = await queueNotification(
        supabase,
        row.user_id,
        'price_alert',
        effectiveChannel,
        subject,
        body,
        {
          productName: product.name,
          productSlug: product.slug,
          triggeredPrice: triggerPrice,
          targetPrice: queueTargetPrice,
          productUrl,
          ...queueExtra,
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
        // New types carry no dollar target (a % threshold is not
        // a price) — record null rather than a misleading number.
        queueTargetPrice,
        effectiveChannel
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

  // Section 19, Phase 6 (§12 #63) — wishlist phase. Every
  // wishlist item is evaluated against the SAME batched data as
  // the alert loop (prices, history, transitions, settings).
  // A wishlist item is not a stored alert row: nothing is
  // inserted into `alerts` (so the tier cap is untouched — the
  // cap counts stored alerts), and nothing is recorded in
  // price_alert_history (its alert_id is NOT NULL with an FK to
  // alerts). Dedupe is by trigger key against notification_queue
  // rows already queued. The master switches are honoured exactly
  // as in the alert loop: priceAlerts off blocks everything; a
  // channel that is off is never used (email preferred, push as
  // the fallback leg — there is no stored channel to degrade).
  if (wishlistItems.length > 0) {
    const queuedKeys = await loadQueuedWishlistTriggerKeys(
      supabase,
      wishlistItems.map((w) => w.userId)
    );

    for (const item of wishlistItems) {
      try {
        const product = productMap.get(item.productId);
        if (!product) {
          result.failed++;
          continue;
        }
        result.wishlistChecked++;

        const { price, availability, recordedAt } = priceMap.get(item.productId) ?? {
          price: null,
          availability: null,
          recordedAt: null,
        };
        const history = historyByProduct.get(item.productId) ?? [];
        const transition = transitionsByProduct.get(item.productId);

        const triggers: WishlistTrigger[] = evaluateWishlistItemTriggers({
          productId: item.productId,
          targetPrice:
            item.targetPrice !== null && Number.isFinite(item.targetPrice)
              ? item.targetPrice
              : null,
          currentPrice: price,
          history,
          inStock: availability === 'in_stock',
          transitionAt: transition?.transition ? transition.transitionAt : null,
        });

        for (const trigger of triggers) {
          // Section 20, §12 #81 — same stale gate as stored
          // alerts: a wishlist "is now $Y" / back-in-stock trigger
          // on a record older than STALE_PRICE_DAYS never fires.
          const triggerRecordedAt =
            trigger.kind === 'back_in_stock'
              ? trigger.transitionAt
              : trigger.kind === 'significant_drop'
                ? (history[0]?.recordedAt ?? null)
                : recordedAt;
          if (
            triggerRecordedAt !== null &&
            alertPriceFreshness(triggerRecordedAt) === 'stale'
          ) {
            result.skippedStale++;
            continue;
          }

          const dedupeKey = `${item.userId}|${trigger.triggerKey}`;
          if (queuedKeys.has(dedupeKey)) {
            result.skippedDuplicate++;
            continue;
          }

          const itemSettings =
            settingsByUser.get(item.userId) ?? DEFAULT_ALERT_DELIVERY_SETTINGS;
          if (!itemSettings.priceAlerts) {
            result.skippedOptedOut++;
            continue;
          }
          // Wishlist alerts have no stored channel: email when
          // on, otherwise push when on, otherwise skipped.
          const effectiveChannel = itemSettings.emailNotifications
            ? 'email'
            : itemSettings.pushNotifications
              ? 'push'
              : null;
          if (!effectiveChannel) {
            result.skippedOptedOut++;
            continue;
          }

          const productUrl = `${appConfig.url}/products/${product.slug}`;
          const triggerLabel =
            trigger.kind === 'price_drop'
              ? 'Price drop on your wishlist'
              : trigger.kind === 'back_in_stock'
                ? 'Back in stock on your wishlist'
                : 'Price drop on your wishlist';
          const subject =
            trigger.kind === 'significant_drop' && trigger.triggerPrice !== null
              ? `${triggerLabel}: ${product.name} is now $${trigger.triggerPrice.toFixed(2)}`
              : trigger.kind === 'back_in_stock'
                ? `${triggerLabel}: ${product.name}`
                : `${triggerLabel}: ${product.name} is now $${(trigger.triggerPrice ?? 0).toFixed(2)}`;
          const body = `${trigger.evidence} View it at ${productUrl}`;
          // Section 20, §12 #81 — unknown-age wishlist trigger:
          // qualify, don't suppress.
          const wishlistBody =
            triggerRecordedAt === null ? body + alertUnknownAgeNote() : body;

          const queued = await queueNotification(
            supabase,
            item.userId,
            'price_alert',
            effectiveChannel,
            subject,
            wishlistBody,
            {
              productName: product.name,
              productSlug: product.slug,
              triggeredPrice: trigger.triggerPrice,
              targetPrice: item.targetPrice,
              productUrl,
              triggerKey: trigger.triggerKey,
              alertKind: 'wishlist',
              wishlistTrigger: trigger.kind,
              evidence: trigger.evidence,
            }
          );

          if (!queued) {
            result.failed++;
            continue;
          }

          // Mark as queued in this run so a second item for the
          // same product cannot queue the same trigger twice.
          queuedKeys.add(dedupeKey);
          result.wishlistTriggered++;
          result.wishlistQueued++;
        }
      } catch (err) {
        logger.error('checkPriceAlerts: wishlist item failed', {
          userId: item.userId,
          productId: item.productId,
          error: String(err),
        });
        result.failed++;
      }
    }
  }

  logger.info('checkPriceAlerts: run finished', { ...result });
  return result;
}
