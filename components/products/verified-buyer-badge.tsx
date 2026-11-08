'use client';

import { BadgeCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

/**
 * Verified Buyer checkmark (Enterprise #9) — receipt-backed only.
 *
 * Renders ONLY when the parent computed `verified === true` via
 * services/verified-buyer.ts (viewer is signed in as the review's
 * author AND holds a vault receipt for this product). It is a
 * different, stronger signal than the review row's own "Verified"
 * badge, which comes from the imported review's verified_purchase
 * flag (the form never sets that flag). Logged-out visitors never
 * see this badge, and no badge is ever an implication that a
 * reviewer did NOT buy the product — it only ever means "receipt
 * proof is available to this viewer".
 */
export function VerifiedBuyerBadge({ verified }: { verified: boolean }) {
  if (!verified) return null;
  return (
    <Badge
      variant="secondary"
      className="border-green-200 bg-green-50 text-xs text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300"
      title="You saved a receipt for this product in your Receipt Vault — this review is backed by that receipt."
    >
      <BadgeCheck className="mr-1 h-3 w-3" />
      Verified Buyer
    </Badge>
  );
}
