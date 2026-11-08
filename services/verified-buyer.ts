/**
 * Verified Buyer badge (Enterprise #9) — receipt-backed proof, never
 * text-based proof.
 *
 * RULE (do not weaken it): a review shows the "Verified Buyer"
 * checkmark ONLY when a receipt-vault record exists for THAT SAME
 * user AND THAT SAME product. The receipt is the proof; the review
 * text, the star rating, and the review's own `verifiedPurchase`
 * flag are never proof. (The form never sets `verifiedPurchase` —
 * see components/products/review-form.tsx — so that flag can only
 * come from an imported review row, never from a self-asserted
 * submission. The vault badge is the stronger, receipt-backed
 * signal and is rendered separately.)
 *
 * HONEST LIMIT — the badge can only ever appear on the VIEWER's own
 * reviews. GET /api/v1/vault is owner-scoped: it returns only the
 * signed-in viewer's own receipts, never anyone else's. A
 * server-side "did ANY reviewer store a receipt?" check would leak
 * private vault data (that a stranger bought this product), so it
 * is deliberately NOT built. Consequences, stated plainly:
 * - Logged-out visitors never see the badge (and no implication
 *   about any reviewer is shown to them).
 * - A signed-in viewer sees it only on their own reviews, and
 *   only when they saved a vault receipt for this product.
 * - No badge on a review means "no receipt proof available to
 *   this viewer", never "this reviewer did not buy the product".
 */

/** Minimal vault-item shape the check needs (from GET /api/v1/vault). */
export interface VaultReceiptRef {
  product_id: string | null;
}

/**
 * Pure: does any vault item reference this product? Null / empty /
 * malformed input is simply "no receipt" — never an error, never a
 * badge.
 */
export function hasVaultReceiptForProduct(
  items: Array<VaultReceiptRef> | null | undefined,
  productId: string
): boolean {
  if (!Array.isArray(items) || !productId) return false;
  return items.some((item) => item != null && item.product_id === productId);
}

/**
 * Pure: should THIS review carry the Verified Buyer checkmark?
 * All three must hold: the review has an author id, the viewer is
 * signed in as that same author, and the viewer holds a vault
 * receipt for this product.
 */
export function isOwnVerifiedReview(args: {
  reviewUserId: string | null | undefined;
  viewerUserId: string | null | undefined;
  viewerHasReceipt: boolean;
}): boolean {
  const { reviewUserId, viewerUserId, viewerHasReceipt } = args;
  if (!reviewUserId || !viewerUserId || !viewerHasReceipt) return false;
  return reviewUserId === viewerUserId;
}

export interface OwnVaultResult {
  /** Product ids the viewer holds a vault receipt for (empty when signed out). */
  productIds: Set<string>;
  /** False when the vault table is not live yet (owner SQL not run). */
  vaultEnabled: boolean;
}

function parseVaultItems(payload: unknown): VaultReceiptRef[] {
  if (payload && typeof payload === 'object') {
    const data = (payload as { data?: unknown }).data;
    if (Array.isArray(data)) return data as VaultReceiptRef[];
  }
  return [];
}

/**
 * Client fetch helper for the viewer's own vault receipts, via the
 * EXISTING owner-scoped GET /api/v1/vault (auth required, own
 * receipts only). Never throws: logged-out (401), vault-not-live
 * (503 / vaultEnabled false), or any network failure all resolve
 * to an empty set, so the page simply shows no badge.
 */
export async function fetchOwnVaultProductIds(): Promise<OwnVaultResult> {
  const empty: OwnVaultResult = { productIds: new Set<string>(), vaultEnabled: false };
  try {
    const res = await fetch('/api/v1/vault');
    if (!res.ok) return empty;
    const payload: unknown = await res.json();
    const items = parseVaultItems(payload);
    const meta = (payload as { meta?: { vaultEnabled?: unknown } }).meta;
    return {
      productIds: new Set(
        items
          .map((item) => item?.product_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      ),
      vaultEnabled: meta?.vaultEnabled === true,
    };
  } catch {
    return empty;
  }
}
