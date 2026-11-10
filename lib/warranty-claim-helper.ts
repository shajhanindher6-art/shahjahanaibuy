/**
 * AI Warranty Claim Helper (Section 7, item 9).
 *
 * Links the Receipt Vault to a claim checklist: documents, the
 * retailer/brand contact, and the steps — plus an expiry claim
 * reminder derived from the vault item's recorded purchase date +
 * warranty months. Warranty expiry is DERIVED on view, never
 * stored.
 *
 * HONESTY:
 * - Retailer/brand contact details are shown ONLY when recorded
 *   in the store directory (lib/stores.ts — a website URL). The
 *   directory records no phone number or email, so none is ever
 *   shown; when no store matches, the UI says "retailer ki website
 *   par warranty section dekhein". No contact detail is ever
 *   invented.
 * - A claim tracked here is a user record only — no refund, repair
 *   or replacement is promised, and SmartBuy never files the claim
 *   with the retailer on the user's behalf.
 *
 * All DB reads are fail-safe: a missing table/column (42P01 /
 * PGRST205 / 42703) returns an empty honest state, never a throw.
 */

import { GLOBAL_STORES, LOCAL_STORES } from '@/lib/stores';
import { logger } from '@/lib/config/logger';
import type { AnySupabaseClient } from '@/lib/supabase/types';

/** Claim statuses (migration contract for `warranty_claims`). */
export const CLAIM_STATUSES = [
  'not_started',
  'in_progress',
  'submitted',
  'resolved',
  'denied',
] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export function isValidClaimStatus(value: unknown): value is ClaimStatus {
  return (
    typeof value === 'string' &&
    (CLAIM_STATUSES as readonly string[]).includes(value)
  );
}

/** A vault item as read for the claim helper (add-receipt-vault.sql). */
export interface VaultItemForClaim {
  id: string;
  title: string;
  store: string | null;
  product_id: string | null;
  purchase_date: string;
  amount: number | null;
  currency: string;
  warranty_months: number;
  receipt_file_name: string | null;
  receipt_file_type: string | null;
  receipt_file_size: number | null;
  receipt_url: string | null;
  created_at: string;
}

export type WarrantyState = 'no_warranty' | 'active' | 'expiring_soon' | 'expired';

export interface ChecklistDocument {
  key: string;
  label: string;
  /** True when the recorded vault data covers this document. */
  present: boolean;
  detail: string;
}

export interface RetailerContact {
  name: string;
  /** Store homepage recorded in the store directory — the only contact shown. */
  websiteUrl: string;
}

export interface ClaimChecklist {
  /** Warranty expiry date (YYYY-MM-DD), or null when no warranty was recorded. */
  expiryDate: string | null;
  /** Whole days until expiry (negative = already expired), or null. */
  daysUntilExpiry: number | null;
  warrantyState: WarrantyState;
  documents: ChecklistDocument[];
  steps: string[];
  retailerContact: RetailerContact | null;
  /** Reminder line when the warranty is expiring soon or expired, else null. */
  reminder: string | null;
}

const DAY_MS = 86_400_000;
const EXPIRING_SOON_DAYS = 30;

function addMonthsUtc(dateStr: string, months: number): Date | null {
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/**
 * Find a retailer in the store directory by the vault item's
 * recorded store name. Returns the recorded homepage only — the
 * directory holds no phone number or email, so none is returned.
 */
export function findRetailerContact(
  storeName: string | null | undefined
): RetailerContact | null {
  if (!storeName || typeof storeName !== 'string') return null;
  const norm = storeName.trim().toLowerCase();
  if (norm === '') return null;
  const stores = [...LOCAL_STORES, ...GLOBAL_STORES];
  const exact = stores.find(
    (s) => s.name.toLowerCase() === norm || s.slug.toLowerCase() === norm
  );
  const partial =
    exact ??
    stores.find(
      (s) =>
        s.name.toLowerCase().includes(norm) || norm.includes(s.name.toLowerCase())
    );
  if (!partial) return null;
  return { name: partial.name, websiteUrl: partial.websiteUrl };
}

/**
 * Build the claim checklist for one vault item. Pure — no I/O.
 * `now` is injectable for tests (defaults to today, UTC, date-only).
 */
export function buildClaimChecklist(
  item: VaultItemForClaim,
  now?: Date
): ClaimChecklist {
  const today = now ? new Date(now.getTime()) : new Date();
  today.setUTCHours(0, 0, 0, 0);

  const months =
    typeof item.warranty_months === 'number' && Number.isFinite(item.warranty_months)
      ? Math.floor(item.warranty_months)
      : 0;
  const expiry = months > 0 ? addMonthsUtc(item.purchase_date, months) : null;
  const expiryDate = expiry ? expiry.toISOString().slice(0, 10) : null;
  const daysUntilExpiry =
    expiry === null ? null : Math.round((expiry.getTime() - today.getTime()) / DAY_MS);

  let warrantyState: WarrantyState = 'no_warranty';
  if (expiry !== null && daysUntilExpiry !== null) {
    if (daysUntilExpiry < 0) warrantyState = 'expired';
    else if (daysUntilExpiry <= EXPIRING_SOON_DAYS) warrantyState = 'expiring_soon';
    else warrantyState = 'active';
  }

  const receiptPresent = Boolean(item.receipt_file_name) || Boolean(item.receipt_url);
  const documents: ChecklistDocument[] = [
    {
      key: 'receipt',
      label: 'Receipt / purchase proof',
      present: receiptPresent,
      detail: item.receipt_file_name
        ? `Receipt file saved in the Vault: ${item.receipt_file_name}.`
        : item.receipt_url
          ? 'Receipt link saved in the Vault.'
          : 'No receipt saved in the Vault — save the receipt first; the retailer will ask for it.',
    },
    {
      key: 'purchase_date',
      label: 'Purchase date',
      present: Boolean(item.purchase_date),
      detail: `Purchased ${item.purchase_date.slice(0, 10)}.`,
    },
    {
      key: 'amount',
      label: 'Purchase amount',
      present:
        typeof item.amount === 'number' && Number.isFinite(item.amount) && item.amount > 0,
      detail:
        typeof item.amount === 'number' && Number.isFinite(item.amount)
          ? `Recorded amount: ${item.amount} ${item.currency ?? 'USD'}.`
          : 'No purchase amount recorded in the Vault.',
    },
    {
      key: 'product',
      label: 'Product identification',
      present: Boolean(item.product_id) || Boolean(item.title),
      detail: item.product_id
        ? 'Linked to a catalog product — use the product name and any serial number on the box.'
        : 'Product name from the Vault title — add the serial number from the box if the retailer asks.',
    },
  ];

  const retailerContact = findRetailerContact(item.store);
  const steps: string[] = [
    expiryDate
      ? `Check the warranty expiry date (${expiryDate}) — file the claim before it passes.`
      : 'No warranty period was recorded for this item — check the box or the retailer listing for the warranty length.',
    'Gather the documents in the checklist above.',
    retailerContact
      ? `Contact ${retailerContact.name} warranty support via their website: ${retailerContact.websiteUrl} — the warranty section there explains how they accept claims.`
      : 'Retailer ki website par warranty section dekhein — SmartBuy ke paas is retailer ka recorded contact nahi hai.',
    'Submit the claim with the documents and keep the claim reference number the retailer gives you.',
    'Track the claim status here and update it when the retailer replies. SmartBuy does not file the claim for you.',
  ];

  const reminder =
    warrantyState === 'expiring_soon'
      ? `Warranty ${daysUntilExpiry} din mein khatam ho rahi hai — claim jald karein.`
      : warrantyState === 'expired'
        ? 'Warranty khatam ho chuki hai — the retailer may still help, but a claim is no longer covered by the recorded warranty.'
        : null;

  return { expiryDate, daysUntilExpiry, warrantyState, documents, steps, retailerContact, reminder };
}

// ---------------------------------------------------------------------------
// DB helpers (fail-safe)
// ---------------------------------------------------------------------------

/** PostgREST reports a missing table as PGRST205, Postgres as 42P01. */
export function isMissingTableError(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

export function isMissingColumnError(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42703';
}

const VAULT_SELECT =
  'id, title, store, product_id, purchase_date, amount, currency, warranty_months, receipt_file_name, receipt_file_type, receipt_file_size, receipt_url, created_at';

export interface VaultClaimItem extends VaultItemForClaim {
  checklist: ClaimChecklist;
}

/**
 * The user's vault items with a claim checklist each. [] + enabled
 * false when the vault table does not exist yet. Never throws.
 */
export async function getVaultItemsForClaims(
  supabase: AnySupabaseClient,
  userId: string
): Promise<{ items: VaultClaimItem[]; enabled: boolean }> {
  try {
    const { data, error } = await supabase
      .from('vault_items')
      .select(VAULT_SELECT)
      .eq('user_id', userId)
      .order('purchase_date', { ascending: false });
    if (error) {
      if (isMissingTableError(error) || isMissingColumnError(error)) {
        return { items: [], enabled: false };
      }
      logger.warn('getVaultItemsForClaims: query failed', { error: error.message });
      return { items: [], enabled: true };
    }
    const items = ((data ?? []) as VaultItemForClaim[]).map((row) => ({
      ...row,
      checklist: buildClaimChecklist(row),
    }));
    return { items, enabled: true };
  } catch (err) {
    logger.warn('getVaultItemsForClaims: unexpected error', { error: String(err) });
    return { items: [], enabled: true };
  }
}

export interface WarrantyClaimRow {
  id: string;
  user_id: string;
  vault_item_id: string | null;
  product_slug: string | null;
  retailer: string | null;
  claim_status: string;
  notes: string | null;
  created_at: string;
}

export interface WarrantyClaimView extends WarrantyClaimRow {
  vaultTitle: string | null;
  vaultStore: string | null;
  purchaseDate: string | null;
}

const CLAIM_SELECT =
  'id, user_id, vault_item_id, product_slug, retailer, claim_status, notes, created_at';

/**
 * The user's tracked warranty claims, with the linked vault item's
 * title/store attached. [] + enabled false when the warranty_claims
 * table does not exist yet (migration not run). Never throws.
 */
export async function getWarrantyClaims(
  supabase: AnySupabaseClient,
  userId: string
): Promise<{ claims: WarrantyClaimView[]; enabled: boolean }> {
  try {
    const { data, error } = await supabase
      .from('warranty_claims')
      .select(CLAIM_SELECT)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      if (isMissingTableError(error) || isMissingColumnError(error)) {
        return { claims: [], enabled: false };
      }
      logger.warn('getWarrantyClaims: query failed', { error: error.message });
      return { claims: [], enabled: true };
    }
    const rows = (data ?? []) as WarrantyClaimRow[];
    if (rows.length === 0) return { claims: [], enabled: true };
    const vaultIds = [...new Set(rows.map((r) => r.vault_item_id).filter((v): v is string => v !== null))];
    const vaultById = new Map<string, { title: string; store: string | null; purchase_date: string }>();
    if (vaultIds.length > 0) {
      const { data: vaultItems } = await supabase
        .from('vault_items')
        .select('id, title, store, purchase_date')
        .in('id', vaultIds);
      for (const v of (vaultItems ?? []) as Array<{ id: string; title: string; store: string | null; purchase_date: string }>) {
        vaultById.set(v.id, v);
      }
    }
    return {
      claims: rows.map((row) => {
        const vault = row.vault_item_id ? vaultById.get(row.vault_item_id) : undefined;
        return {
          ...row,
          vaultTitle: vault?.title ?? null,
          vaultStore: vault?.store ?? null,
          purchaseDate: vault?.purchase_date ?? null,
        };
      }),
      enabled: true,
    };
  } catch (err) {
    logger.warn('getWarrantyClaims: unexpected error', { error: String(err) });
    return { claims: [], enabled: true };
  }
}

export interface TrackClaimInput {
  vaultItemId?: string | null;
  productSlug?: string | null;
  retailer?: string | null;
  claimStatus?: string | null;
  notes?: string | null;
}

/**
 * Track a claim. When a vault item is given, it must belong to the
 * user (ownership checked), the retailer/product are derived from
 * it, and a second track for the same vault item updates the
 * existing claim instead of duplicating it (partial unique index
 * on (user_id, vault_item_id)). Returns missingTable when the
 * migration has not been run. Never throws.
 */
export async function trackWarrantyClaim(
  supabase: AnySupabaseClient,
  userId: string,
  input: TrackClaimInput
): Promise<
  | { claim: WarrantyClaimRow; deduped: boolean }
  | { error: { code?: string; message: string }; missingTable?: boolean; notFound?: boolean }
> {
  const status: ClaimStatus =
    input.claimStatus && isValidClaimStatus(input.claimStatus) ? input.claimStatus : 'not_started';
  const notes =
    typeof input.notes === 'string' && input.notes.trim() !== ''
      ? input.notes.trim().slice(0, 2000)
      : null;

  let vaultItem: VaultItemForClaim | null = null;
  let productSlug: string | null =
    typeof input.productSlug === 'string' && input.productSlug.trim() !== ''
      ? input.productSlug.trim().slice(0, 200)
      : null;
  let retailer: string | null =
    typeof input.retailer === 'string' && input.retailer.trim() !== ''
      ? input.retailer.trim().slice(0, 200)
      : null;

  try {
    if (input.vaultItemId) {
      const { data, error } = await supabase
        .from('vault_items')
        .select(VAULT_SELECT)
        .eq('id', input.vaultItemId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) {
        if (isMissingTableError(error) || isMissingColumnError(error)) {
          return { error: { code: error.code, message: 'Receipt Vault is not set up yet.' }, missingTable: true };
        }
        return { error: { code: error.code, message: 'Failed to read the vault item' } };
      }
      if (!data) return { error: { message: 'Vault item not found' }, notFound: true };
      vaultItem = data as VaultItemForClaim;
      retailer = retailer ?? vaultItem.store;
      if (vaultItem.product_id && !productSlug) {
        const { data: product } = await supabase
          .from('products')
          .select('slug')
          .eq('id', vaultItem.product_id)
          .maybeSingle();
        if (product && typeof (product as { slug?: unknown }).slug === 'string') {
          productSlug = (product as { slug: string }).slug;
        }
      }
    }

    if (vaultItem) {
      const { data: existing, error: existingError } = await supabase
        .from('warranty_claims')
        .select(CLAIM_SELECT)
        .eq('user_id', userId)
        .eq('vault_item_id', vaultItem.id)
        .maybeSingle();
      if (existingError) {
        if (isMissingTableError(existingError) || isMissingColumnError(existingError)) {
          return { error: { code: existingError.code, message: 'Warranty claims are not set up yet.' }, missingTable: true };
        }
        return { error: { code: existingError.code, message: 'Failed to read warranty claims' } };
      }
      if (existing) {
        const { data, error } = await supabase
          .from('warranty_claims')
          .update({ claim_status: status, notes, retailer })
          .eq('id', (existing as WarrantyClaimRow).id)
          .eq('user_id', userId)
          .select(CLAIM_SELECT)
          .single();
        if (error || !data) {
          return { error: { code: error?.code, message: 'Failed to update the warranty claim' } };
        }
        return { claim: data as WarrantyClaimRow, deduped: true };
      }
    }

    const { data, error } = await supabase
      .from('warranty_claims')
      .insert({
        user_id: userId,
        vault_item_id: vaultItem ? vaultItem.id : null,
        product_slug: productSlug,
        retailer,
        claim_status: status,
        notes,
      })
      .select(CLAIM_SELECT)
      .single();
    if (error || !data) {
      if (isMissingTableError(error) || isMissingColumnError(error)) {
        return { error: { code: error?.code, message: 'Warranty claims are not set up yet.' }, missingTable: true };
      }
      return { error: { code: error?.code, message: 'Failed to track the warranty claim' } };
    }
    return { claim: data as WarrantyClaimRow, deduped: false };
  } catch (err) {
    logger.warn('trackWarrantyClaim: unexpected error', { error: String(err) });
    return { error: { message: 'Failed to track the warranty claim' } };
  }
}
