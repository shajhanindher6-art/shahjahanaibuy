/**
 * "Verified Merchant" badge (Section 5 #15).
 *
 * Renders ONLY when `verified === true` — i.e. the merchant's recorded
 * data met every public standard (price accuracy ≥95% across 10+
 * audits, 14+ day returns, 12+ month warranty, trust grade A/B, a
 * published policy page) and the verification is inside its 90-day
 * window. No merchant carries the badge today, so this renders
 * nothing anywhere until one earns it.
 *
 * The title/meaning text states what the badge does — and does not —
 * mean, so the badge is never a vague trust claim.
 */

'use client';

import { BadgeCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { VERIFIED_MERCHANT_MEANING } from '@/lib/verified-merchants';

interface VerifiedMerchantBadgeProps {
  /** True only when the merchant is currently verified. */
  verified: boolean;
  /** Optional: show the merchant's verification expiry ("Verified until …"). */
  verifiedUntil?: string | null;
}

export function VerifiedMerchantBadge({ verified, verifiedUntil }: VerifiedMerchantBadgeProps) {
  if (!verified) return null;
  return (
    <Badge
      variant="secondary"
      className="border-blue-200 bg-blue-50 text-xs text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
      title={VERIFIED_MERCHANT_MEANING}
    >
      <BadgeCheck className="mr-1 h-3 w-3" />
      Verified Merchant
      {verifiedUntil ? ` · until ${new Date(verifiedUntil).toLocaleDateString()}` : ''}
    </Badge>
  );
}
