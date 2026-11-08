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
 * sign in for notifications and cross-device sync.
 */

export interface LocalPriceAlert {
  id: string;
  productId: string;
  productName: string;
  targetPrice: number;
  alertType: 'price_drop';
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
  return (
    typeof v.id === 'string' &&
    v.id.length > 0 &&
    typeof v.productId === 'string' &&
    v.productId.length > 0 &&
    typeof v.productName === 'string' &&
    typeof v.targetPrice === 'number' &&
    Number.isFinite(v.targetPrice) &&
    v.targetPrice > 0 &&
    v.alertType === 'price_drop' &&
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
  targetPrice: number;
}

export type SaveLocalAlertResult =
  | { ok: true; alert: LocalPriceAlert }
  | { ok: false; error: string };

/**
 * Save a guest target-price alert for a product. Validates the target
 * (must be a finite number > 0) and caps the device store at
 * MAX_LOCAL_ALERTS, dropping the oldest alert first. Never throws.
 */
export function saveLocalAlert(
  input: SaveLocalAlertInput
): SaveLocalAlertResult {
  if (
    typeof input.targetPrice !== 'number' ||
    !Number.isFinite(input.targetPrice) ||
    input.targetPrice <= 0
  ) {
    return { ok: false, error: 'Enter a target price above $0.' };
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
    targetPrice: input.targetPrice,
    alertType: 'price_drop',
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

/** Guest alerts saved for one product, in stored order. Never throws. */
export function listLocalAlertsForProduct(
  productId: string
): LocalPriceAlert[] {
  return loadLocalAlerts().filter((a) => a.productId === productId);
}
