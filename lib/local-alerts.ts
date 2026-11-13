/**
 * Guest (logged-out) target-price alerts, stored on the device only.
 *
 * Option 15 Module 3 — guest mode for the price-alert dialog.
 * Signed-in users keep using the Supabase-backed /api/v1/alerts flow;
 * this module is the LocalStorage fallback for visitors who are not
 * signed in. It never touches the network, never imports Supabase,
 * and never throws: every function degrades to an empty list / a
 * failed result when localStorage is unavailable (SSR, private mode,
 * quota errors) or the stored data is corrupt.
 *
 * Honest limit, surfaced in the dialog on every guest render: these
 * alerts live on this device only. Nothing checks them in the
 * background and no email/push is ever sent for them — the user must
 * sign in for notifications and cross-device sync. Signing in DOES
 * merge them into the account (lib/guest-merge.ts, run from the
 * AuthProvider after sign-in): only alerts the account does not
 * already have are created, and this key is cleared only after the
 * server confirms the merge.
 */

export interface LocalPriceAlert {
  id: string;
  productId: string;
  productName: string;
  /** Null for back-in-stock alerts (no price target). */
  targetPrice: number | null;
  alertType: 'price_drop' | 'back_in_stock';
  channel: 'local';
  createdAt: string;
}

export const LOCAL_ALERTS_STORAGE_KEY = 'sb-local-price-alerts';

/** Maximum number of guest alerts kept on one device (oldest dropped first). */
export const MAX_LOCAL_ALERTS = 20;

/** Safe access to localStorage — null when unavailable (SSR / private mode). */
function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function isValidAlert(value: unknown): value is LocalPriceAlert {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const targetOk =
    v.alertType === 'back_in_stock'
      ? v.targetPrice === null || v.targetPrice === undefined
      : typeof v.targetPrice === 'number' &&
        Number.isFinite(v.targetPrice) &&
        v.targetPrice > 0;
  return (
    typeof v.id === 'string' &&
    v.id.length > 0 &&
    typeof v.productId === 'string' &&
    v.productId.length > 0 &&
    typeof v.productName === 'string' &&
    targetOk &&
    (v.alertType === 'price_drop' || v.alertType === 'back_in_stock') &&
    v.channel === 'local' &&
    typeof v.createdAt === 'string'
  );
}

function newAlertId(): string {
  try {
    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID === 'function'
    ) {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the non-crypto fallback below.
  }
  return `local-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

/**
 * Load all guest alerts stored on this device.
 * Parse failure, corrupt data, a non-array payload, or unavailable
 * storage all yield [] — never throws.
 */
export function loadLocalAlerts(): LocalPriceAlert[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(LOCAL_ALERTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidAlert);
  } catch {
    return [];
  }
}

function persist(alerts: LocalPriceAlert[]): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(LOCAL_ALERTS_STORAGE_KEY, JSON.stringify(alerts));
    return true;
  } catch {
    return false;
  }
}

export interface SaveLocalAlertInput {
  productId: string;
  productName: string;
  /** Required for price_drop; ignored for back_in_stock. */
  targetPrice?: number | null;
  alertType?: 'price_drop' | 'back_in_stock';
}

export type SaveLocalAlertResult =
  | { ok: true; alert: LocalPriceAlert }
  | { ok: false; error: string };

/**
 * Save a guest target-price (or back-in-stock) alert for a product.
 * Validates the target (price_drop needs a finite number > 0) and
 * caps the device store at MAX_LOCAL_ALERTS, dropping the oldest
 * alert first. Never throws.
 */
export function saveLocalAlert(
  input: SaveLocalAlertInput
): SaveLocalAlertResult {
  const alertType = input.alertType ?? 'price_drop';
  if (alertType === 'price_drop') {
    if (
      typeof input.targetPrice !== 'number' ||
      !Number.isFinite(input.targetPrice) ||
      input.targetPrice <= 0
    ) {
      return { ok: false, error: 'Enter a target price above $0.' };
    }
  }
  if (!input.productId || !input.productName) {
    return { ok: false, error: 'Missing product information.' };
  }
  const store = storage();
  if (!store) {
    return { ok: false, error: 'Alerts cannot be saved on this device.' };
  }
  const alert: LocalPriceAlert = {
    id: newAlertId(),
    productId: input.productId,
    productName: input.productName,
    targetPrice: alertType === 'price_drop' ? (input.targetPrice as number) : null,
    alertType,
    channel: 'local',
    createdAt: new Date().toISOString(),
  };
  const alerts = loadLocalAlerts();
  alerts.push(alert);
  while (alerts.length > MAX_LOCAL_ALERTS) {
    alerts.shift();
  }
  if (!persist(alerts)) {
    return { ok: false, error: 'Alerts cannot be saved on this device.' };
  }
  return { ok: true, alert };
}

/**
 * Delete one guest alert by id and return the remaining alerts.
 * Never throws; unknown ids are a no-op.
 */
export function removeLocalAlert(id: string): LocalPriceAlert[] {
  const alerts = loadLocalAlerts().filter((a) => a.id !== id);
  persist(alerts);
  return alerts;
}

/**
 * Merge hook (Section 12, Chunk B): clear all guest alerts on this
 * device. Called ONLY by lib/guest-merge.ts after the server has
 * confirmed every new alert was created on the account — never
 * before. If the merge fails part-way the key is left untouched so
 * the next sign-in can retry; already-created alerts are deduped
 * out on that retry.
 */
export function clearLocalAlerts(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(LOCAL_ALERTS_STORAGE_KEY);
  } catch {
    // Storage blocked — the key simply stays; the next merge run
    // dedupes the already-created alerts out before posting.
  }
}

/** Guest alerts saved for one product, in stored order. Never throws. */
export function listLocalAlertsForProduct(
  productId: string
): LocalPriceAlert[] {
  return loadLocalAlerts().filter((a) => a.productId === productId);
}

// ---------------------------------------------------------------------------
// S3#7 — guest email alerts (opt-in). Client helper + validation.
// ---------------------------------------------------------------------------

/** Minimal email shape check — the server re-validates before storing. */
export function isValidEmail(email: unknown): email is string {
  return (
    typeof email === 'string' &&
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())
  );
}

export interface GuestEmailAlertInput {
  email: string;
  productId: string;
  alertType: 'price_drop' | 'back_in_stock' | 'deal';
  targetPrice?: number | null;
  guestToken?: string | null;
}

export type SubmitGuestEmailAlertResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Opt a guest email into server-side alerts (POST /api/v1/alerts/guest).
 * The email is stored with an unsubscribe token; delivery happens
 * only when the scheduled price refresh runs AND Resend is configured
 * — this helper never claims an email was sent. Never throws.
 */
export async function submitGuestEmailAlert(
  input: GuestEmailAlertInput
): Promise<SubmitGuestEmailAlertResult> {
  if (!isValidEmail(input.email)) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  try {
    const res = await fetch('/api/v1/alerts/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: input.email.trim(),
        productId: input.productId,
        alertType: input.alertType,
        targetPrice: input.targetPrice ?? null,
        guestToken: input.guestToken ?? null,
      }),
    });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const message =
        data && typeof data === 'object' && 'error' in data
          ? (data as { error?: { message?: string } }).error?.message
          : null;
      return { ok: false, error: message ?? 'Could not save the email alert. Please try again.' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not save the email alert. Please try again.' };
  }
}

// ---------------------------------------------------------------------------
// S3#3 + S3#7 — pure server-side decision helpers (no I/O).
// Used by app/api/v1/prices/refresh/route.ts and unit-tested here so
// the refresh chain's trigger rules are provable without a database.
// ---------------------------------------------------------------------------

export interface AvailabilitySnapshot {
  availability: 'in_stock' | 'out_of_stock' | 'unknown';
  inStock: boolean;
  price: number | null;
}

/**
 * Record a new availability_history row only when the snapshot
 * actually changed (or there is no previous row). Unchanged stock
 * creates no rows, so the history never shows fake fluctuations.
 */
export function shouldRecordAvailabilitySnapshot(
  previous: AvailabilitySnapshot | null,
  next: AvailabilitySnapshot
): boolean {
  if (!previous) return true;
  return (
    previous.availability !== next.availability ||
    previous.inStock !== next.inStock ||
    previous.price !== next.price
  );
}

/** True only on a genuine out-of-stock → in-stock transition. */
export function isBackInStockTransition(
  previous: AvailabilitySnapshot | null,
  next: AvailabilitySnapshot
): boolean {
  if (!previous) return false;
  return !previous.inStock && next.inStock;
}

export interface GuestAlertTriggerState {
  alertType: 'price_drop' | 'back_in_stock' | 'deal';
  targetPrice: number | null;
  lastTriggeredPrice: number | null;
  lastTriggeredAt: string | null;
}

export interface GuestAlertCurrentState {
  price: number | null;
  /** The product is in stock right now (informational only). */
  backInStock: boolean;
  /**
   * Section 19, Phase 6 (§12 #67) — a REAL recorded out→in
   * transition happened for this product in this run. This is
   * the ONLY thing that fires a back_in_stock alert. The
   * refresh step passes the transition set computed by
   * recordAvailabilitySnapshots (isBackInStockTransition on
   * availability_history), never raw in-stock membership — so a
   * product that was already in stock on every run never
   * refires. When the caller cannot prove a transition (field
   * absent / false) the alert does NOT fire.
   */
  backInStockTransition?: boolean;
  hasActiveDeal: boolean;
  now?: Date;
}

/**
 * Should this guest email alert fire right now?
 * - price_drop: current price at/below target AND not already fired
 *   at this exact price (one email per distinct triggered price).
 * - back_in_stock: only on a recorded out→in transition, never just
 *   because the product happens to be in stock.
 * - deal: at most once per 24h while a deal stays active.
 * Nothing here invents a price or a deal — all inputs are recorded
 * values passed in by the caller.
 */
export function shouldTriggerGuestAlert(
  alert: GuestAlertTriggerState,
  current: GuestAlertCurrentState
): boolean {
  if (alert.alertType === 'price_drop') {
    if (alert.targetPrice === null || current.price === null) return false;
    if (current.price > alert.targetPrice) return false;
    return alert.lastTriggeredPrice !== current.price;
  }
  if (alert.alertType === 'back_in_stock') {
    // §12 #67: only a recorded out→in transition fires. Being
    // in stock right now (current.backInStock) is NOT a trigger —
    // a product that never left stock would otherwise refire on
    // every refresh run.
    return current.backInStockTransition === true;
  }
  if (alert.alertType === 'deal') {
    if (!current.hasActiveDeal) return false;
    if (!alert.lastTriggeredAt) return true;
    const last = new Date(alert.lastTriggeredAt).getTime();
    if (!Number.isFinite(last)) return true;
    const now = (current.now ?? new Date()).getTime();
    return now - last >= 24 * 60 * 60 * 1000;
  }
  return false;
}
