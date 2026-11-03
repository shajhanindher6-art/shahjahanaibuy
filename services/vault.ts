/**
 * Receipt Vault helpers (Option 8, Feature 3) — pure date math.
 * Warranty expiry = purchase date + warranty months (calendar months).
 * Alerts are ON-VIEW only: "expiring soon" is computed when the vault is
 * rendered. No background/email warranty alerts are claimed or wired.
 */

export const EXPIRING_SOON_DAYS = 30;

export function warrantyExpiryDate(purchaseDate: string, warrantyMonths: number): Date | null {
  const d = new Date(purchaseDate);
  if (Number.isNaN(d.getTime())) return null;
  if (!Number.isFinite(warrantyMonths) || warrantyMonths < 0) return null;
  const expiry = new Date(d);
  expiry.setMonth(expiry.getMonth() + Math.floor(warrantyMonths));
  return expiry;
}

export function daysUntil(date: Date, now: Date = new Date()): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.ceil((startOfTarget.getTime() - startOfToday.getTime()) / msPerDay);
}

export type WarrantyStatus = 'active' | 'expiring-soon' | 'expired' | 'unknown';

export function warrantyStatus(
  purchaseDate: string,
  warrantyMonths: number,
  now: Date = new Date()
): { status: WarrantyStatus; daysLeft: number | null; expiry: Date | null } {
  const expiry = warrantyExpiryDate(purchaseDate, warrantyMonths);
  if (!expiry) return { status: 'unknown', daysLeft: null, expiry: null };
  const left = daysUntil(expiry, now);
  if (left < 0) return { status: 'expired', daysLeft: left, expiry };
  if (left <= EXPIRING_SOON_DAYS) return { status: 'expiring-soon', daysLeft: left, expiry };
  return { status: 'active', daysLeft: left, expiry };
}
