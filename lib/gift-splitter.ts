/**
 * Gift Budget Splitter — pure helpers for /tools/gift-splitter
 * (Section 13, Chunk B).
 *
 * Split ONE total gift budget across MULTIPLE recipients, with one
 * catalog pick per recipient. This is the split neither existing
 * tool does: gift-finder is one recipient, bundle-allocator splits
 * across categories.
 *
 * Honesty rules:
 * - Occasion is display-only (same as services/gift-finder.ts —
 *   the catalog has no occasion tagging; inventing an occasion →
 *   product mapping would be fake personalization).
 * - No invented weights: shares are EQUAL unless the user enters
 *   explicit weights. A missing weight is never defaulted from
 *   anything but equality.
 * - Picks come from services/gift-finder.ts (findGiftPicks) over
 *   real priced catalog products; a recipient whose share buys
 *   nothing gets an honest "no priced gift fits this share" line,
 *   never a forced over-budget pick.
 * - Money is split to the cent; the rounding remainder (at most a
 *   few cents) goes to the first recipient, and the page shows the
 *   exact shares so the total always adds up.
 */

import {
  findGiftPicks,
  type GiftCandidate,
  type GiftPick,
} from '@/services/gift-finder';

export interface GiftRecipientInput {
  /** Recipient name, as typed (trimmed; empty names are rejected). */
  name: string;
  /** Optional interests, matched against catalog keywords. */
  interests: string[];
  /**
   * Optional user-entered weight. null/undefined means "equal
   * share". A weight is never inferred — only equal or entered.
   */
  weight: number | null;
}

export interface GiftRecipientShare {
  name: string;
  interests: string[];
  /** Share of the total, in USD, to the cent. */
  shareUsd: number;
  /** Weight actually used (1 when the split is equal). */
  weightUsed: number;
  /** True when every recipient got an equal share. */
  isEqualSplit: boolean;
}

export interface GiftSplitResult {
  totalUsd: number;
  shares: GiftRecipientShare[];
  isEqualSplit: boolean;
}

export const GIFT_SPLIT_MAX_RECIPIENTS = 20;

/** Validate the raw form inputs; returns an error string or null. */
export function validateGiftSplitInput(
  totalUsd: number,
  recipients: GiftRecipientInput[]
): string | null {
  if (!Number.isFinite(totalUsd) || totalUsd <= 0) {
    return 'Enter a total gift budget above $0.';
  }
  if (recipients.length === 0) {
    return 'Add at least one recipient.';
  }
  if (recipients.length > GIFT_SPLIT_MAX_RECIPIENTS) {
    return `At most ${GIFT_SPLIT_MAX_RECIPIENTS} recipients per split.`;
  }
  for (const r of recipients) {
    if (!r.name || r.name.trim().length === 0) {
      return 'Every recipient needs a name.';
    }
  }
  const names = recipients.map((r) => r.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) {
    return 'Recipient names must be different — two entries share a name.';
  }
  for (const r of recipients) {
    if (r.weight !== null && (!Number.isFinite(r.weight) || r.weight <= 0)) {
      return `Weight for ${r.name.trim()} must be a positive number, or left blank for an equal share.`;
    }
  }
  return null;
}

/**
 * Split the total across recipients to the cent. Equal shares
 * unless weights were entered; when any weight is entered, the
 * unweighted recipients share weight 1 each. The rounding
 * remainder goes to the first recipient so shares always sum
 * exactly to the total.
 */
export function splitGiftBudget(
  totalUsd: number,
  recipients: GiftRecipientInput[]
): GiftSplitResult {
  const totalCents = Math.round(totalUsd * 100);
  const anyWeight = recipients.some((r) => r.weight !== null);
  const weights = recipients.map((r) =>
    r.weight !== null ? r.weight : anyWeight ? 1 : 1
  );
  const weightSum = weights.reduce((s, w) => s + w, 0);
  const isEqualSplit = !anyWeight;

  // Floor each share to the cent, then hand the leftover cents
  // (fewer than the recipient count) to the first recipients in
  // order — first recipient first — so the sum is exact.
  const rawCents = weights.map((w) => (totalCents * w) / weightSum);
  const floorCents = rawCents.map((c) => Math.floor(c));
  let leftover = totalCents - floorCents.reduce((s, c) => s + c, 0);
  const cents = [...floorCents];
  let i = 0;
  while (leftover > 0) {
    cents[i % cents.length] += 1;
    leftover -= 1;
    i += 1;
  }

  return {
    totalUsd: totalCents / 100,
    isEqualSplit,
    shares: recipients.map((r, idx) => ({
      name: r.name.trim(),
      interests: r.interests,
      shareUsd: cents[idx] / 100,
      weightUsed: weights[idx],
      isEqualSplit,
    })),
  };
}

/** One top pick per recipient share (null when nothing fits). */
export function suggestPicksForSplit(
  candidates: GiftCandidate[],
  shares: GiftRecipientShare[]
): Array<{ share: GiftRecipientShare; pick: GiftPick | null }> {
  return shares.map((share) => {
    const picks = findGiftPicks(candidates, {
      budgetUsd: share.shareUsd,
      interests: share.interests,
      limit: 1,
    });
    return { share, pick: picks[0] ?? null };
  });
}

/**
 * Parse the page's GET params: ?total=…&name=…&name=…&weight=…&
 * weight=…&interests=…&interests=…&occasion=…. Repeated params
 * line up by position; a missing weight means "equal share".
 */
export function parseGiftSplitParams(searchParams: {
  total?: string | string[];
  name?: string | string[];
  weight?: string | string[];
  interests?: string | string[];
  occasion?: string | string[];
}): {
  totalUsd: number | null;
  recipients: GiftRecipientInput[];
  occasion: string;
  totalError: string | null;
} {
  const rawTotal = Array.isArray(searchParams.total)
    ? searchParams.total[0]
    : searchParams.total;
  const rawOccasion = Array.isArray(searchParams.occasion)
    ? searchParams.occasion[0]
    : searchParams.occasion;
  const occasion = (rawOccasion ?? '').trim();

  const names = (
    searchParams.name === undefined
      ? []
      : Array.isArray(searchParams.name)
        ? searchParams.name
        : [searchParams.name]
  ).filter((n) => n.trim().length > 0);
  const weightsRaw =
    searchParams.weight === undefined
      ? []
      : Array.isArray(searchParams.weight)
        ? searchParams.weight
        : [searchParams.weight];
  const interestsRaw =
    searchParams.interests === undefined
      ? []
      : Array.isArray(searchParams.interests)
        ? searchParams.interests
        : [searchParams.interests];

  let totalUsd: number | null = null;
  let totalError: string | null = null;
  if (rawTotal !== undefined && rawTotal.trim().length > 0) {
    const parsed = Number(rawTotal);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      totalError = `"${rawTotal}" is not a valid total — enter a positive amount in USD.`;
    } else {
      totalUsd = Math.round(parsed * 100) / 100;
    }
  }

  const recipients: GiftRecipientInput[] = names.map((name, idx) => {
    const rawWeight = (weightsRaw[idx] ?? '').trim();
    let weight: number | null = null;
    if (rawWeight.length > 0) {
      const parsed = Number(rawWeight);
      weight = Number.isFinite(parsed) ? parsed : NaN;
    }
    const interests = (interestsRaw[idx] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return { name: name.trim(), interests, weight };
  });

  return { totalUsd, recipients, occasion, totalError };
}
